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
export async function enforceRateLimit(
  uid: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
  message?: string,
  weight = 1,
) {
  if (!Number.isInteger(weight) || weight < 1) throw new Error('A rate-limit weight must be a positive integer.')
  const windowId = Math.floor(Date.now() / (windowSeconds * 1_000))
  const reference = getFirestore().collection('rateLimits').doc(`${uid}_${bucket}_${windowId}`)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const current = (snapshot.get('count') as number | undefined) ?? 0
    // A weighted charge is all-or-nothing: a variation batch that cannot fit inside the remaining
    // budget must not partially consume it, or two simultaneous requests could straddle the limit.
    if (current + weight > limit) {
      const window = windowSeconds >= 60 ? `${windowSeconds / 60} min` : `${windowSeconds}s`
      const retryAfterSeconds = Math.max(1, Math.ceil(((windowId + 1) * windowSeconds * 1_000 - Date.now()) / 1_000))
      throw new RateLimitError(message ?? `Too many requests. Limit is ${limit} per ${window}. Wait a moment and try again.`, retryAfterSeconds)
    }
    transaction.set(reference, {
      uid,
      bucket,
      count: FieldValue.increment(weight),
      expiresAt: Timestamp.fromMillis((windowId + 1) * windowSeconds * 1_000),
    }, { merge: true })
  })
}
