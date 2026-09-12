import { createPublicKey, verify } from 'node:crypto'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { z } from 'zod'

export const webhookPayloadSchema = z.object({
  type: z.string().trim().min(1).max(64),
  webhookId: z.string().trim().min(1).max(128),
  locationId: z.string().trim().min(1).max(128),
}).passthrough()

export type HighLevelWebhookPayload = z.infer<typeof webhookPayloadSchema>

const relevantEventTypes = new Set([
  'ContactCreate',
  'ContactUpdate',
  'ContactDelete',
  'InboundMessage',
  'AppointmentCreate',
  'AppointmentUpdate',
])

const WEBHOOK_EVENT_TTL_MS = 24 * 60 * 60_000
const WEBHOOK_DEDUPE_TTL_MS = 24 * 60 * 60_000

/**
 * Ed25519 only (HighLevel's current signing scheme). The legacy RSA `x-wh-signature` transition
 * header is not supported, trading a little backward compatibility for a smaller surface.
 */
export function verifyHighLevelSignature(rawBody: Buffer, signatureBase64: string, publicKeyPem: string): boolean {
  if (!publicKeyPem || !signatureBase64) return false
  try {
    const publicKey = createPublicKey(publicKeyPem)
    const signature = Buffer.from(signatureBase64, 'base64')
    return verify(null, rawBody, publicKey, signature)
  } catch {
    return false
  }
}

/**
 * Firestore `.create()` throws ALREADY_EXISTS for a second delivery of the same webhookId, giving
 * us an atomic dedupe check without a transaction.
 */
export async function claimWebhookDelivery(webhookId: string): Promise<'claimed' | 'duplicate'> {
  const reference = getFirestore().collection('webhookDedupe').doc(webhookId)
  try {
    await reference.create({
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_DEDUPE_TTL_MS),
    })
    return 'claimed'
  } catch (cause) {
    if ((cause as { code?: number }).code === 6) return 'duplicate'
    throw cause
  }
}

async function findOwnerByLocationId(locationId: string): Promise<string | undefined> {
  const snapshot = await getFirestore().collection('highlevelConnections')
    .where('locationId', '==', locationId)
    .limit(1)
    .get()
  return snapshot.docs[0]?.id
}

export type WebhookOutcome = 'invalid_signature' | 'duplicate' | 'delivered' | 'ignored' | 'no_owner'

export async function handleHighLevelWebhookPayload(
  rawBody: Buffer,
  signatureBase64: string | undefined,
  publicKeyPem: string,
  payload: HighLevelWebhookPayload,
): Promise<WebhookOutcome> {
  if (!verifyHighLevelSignature(rawBody, signatureBase64 ?? '', publicKeyPem)) return 'invalid_signature'
  if (await claimWebhookDelivery(payload.webhookId) === 'duplicate') return 'duplicate'

  const uid = await findOwnerByLocationId(payload.locationId)
  if (!uid) return 'no_owner'

  const db = getFirestore()
  if (payload.type === 'UNINSTALL') {
    await db.collection('highlevelConnections').doc(uid).delete()
    return 'delivered'
  }
  if (!relevantEventTypes.has(payload.type)) return 'ignored'

  await db.collection('users').doc(uid).collection('hlEvents').add({
    type: payload.type,
    payload,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + WEBHOOK_EVENT_TTL_MS),
  })
  return 'delivered'
}
