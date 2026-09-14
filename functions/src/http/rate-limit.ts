import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

export class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message)
  }
}

/**
 * Fixed-window counter per (uid, bucket). Each window is its own document so a
 * Firestore TTL policy on `expiresAt` can clean these up automatically once configured
 * (gcloud firestore fields ttls create --collection-group=rateLimits --field=expiresAt).
 */
export async function enforceRateLimit(uid: string, bucket: string, limit: number, windowSeconds: number, message?: string) {
  const windowId = Math.floor(Date.now() / (windowSeconds * 1_000))
  const reference = getFirestore().collection('rateLimits').doc(`${uid}_${bucket}_${windowId}`)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const current = (snapshot.get('count') as number | undefined) ?? 0
    if (current >= limit) {
      const window = windowSeconds >= 60 ? `${windowSeconds / 60} min` : `${windowSeconds}s`
      const retryAfterSeconds = Math.max(1, Math.ceil(((windowId + 1) * windowSeconds * 1_000 - Date.now()) / 1_000))
      throw new RateLimitError(message ?? `Too many requests. Limit is ${limit} per ${window}. Wait a moment and try again.`, retryAfterSeconds)
    }
    transaction.set(reference, {
      uid,
      bucket,
      count: FieldValue.increment(1),
      expiresAt: Timestamp.fromMillis((windowId + 1) * windowSeconds * 1_000),
    }, { merge: true })
  })
}
