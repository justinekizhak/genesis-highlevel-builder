import { describe, expect, it, vi } from 'vitest'

type FakeDoc = { count?: number }

function makeFakeFirestore() {
  const docs = new Map<string, FakeDoc>()
  const docRef = (id: string) => ({
    id,
    get: async () => ({ get: (field: string) => (field === 'count' ? docs.get(id)?.count : undefined) }),
  })
  const firestore = {
    collection: () => ({ doc: (id: string) => docRef(id) }),
    runTransaction: async (callback: (transaction: unknown) => Promise<number>) => callback({
      get: async (reference: ReturnType<typeof docRef>) => reference.get(),
      set: (reference: ReturnType<typeof docRef>, data: { count?: unknown }, _options: unknown) => {
        const current = docs.get(reference.id) ?? {}
        const increment = typeof data.count === 'object' && data.count !== null
          ? ((data.count as { operand?: number }).operand ?? 1)
          : (data.count as number)
        docs.set(reference.id, { count: (current.count ?? 0) + (increment ?? 1) })
      },
    }),
  }
  return firestore
}

describe('enforceRateLimit', () => {
  it('allows requests under the limit and rejects the one that exceeds it', async () => {
    vi.resetModules()
    const firestore = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { enforceRateLimit, RateLimitError } = await import('./rate-limit.js')

    await enforceRateLimit('user-1', 'generate-minute', 2, 60)
    await enforceRateLimit('user-1', 'generate-minute', 2, 60)
    await expect(enforceRateLimit('user-1', 'generate-minute', 2, 60)).rejects.toThrow(RateLimitError)
    vi.doUnmock('firebase-admin/firestore')
  })

  it('keeps separate buckets independent', async () => {
    vi.resetModules()
    const firestore = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { enforceRateLimit } = await import('./rate-limit.js')

    await enforceRateLimit('user-1', 'generate-minute', 1, 60)
    await expect(enforceRateLimit('user-1', 'hl-proxy-minute', 1, 60)).resolves.toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
  })

  it('uses the friendly default message naming the window', async () => {
    vi.resetModules()
    const firestore = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { enforceRateLimit } = await import('./rate-limit.js')
    await enforceRateLimit('user-2', 'generate-day', 1, 86_400)
    await expect(enforceRateLimit('user-2', 'generate-day', 1, 86_400)).rejects.toThrow('1440 min')
    vi.doUnmock('firebase-admin/firestore')
  })

  it('provides a bounded Retry-After value', async () => {
    vi.resetModules()
    const firestore = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { enforceRateLimit, RateLimitError } = await import('./rate-limit.js')
    await enforceRateLimit('user-3', 'proxy-minute', 1, 60)
    const error = await enforceRateLimit('user-3', 'proxy-minute', 1, 60).catch((cause) => cause)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(60)
    vi.doUnmock('firebase-admin/firestore')
  })
})

describe('weighted rate limiting', () => {
  async function loadWeighted() {
    vi.resetModules()
    const firestore = makeFakeFirestore()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    return import('./rate-limit.js')
  }

  it('atomically charges a supplied weight', async () => {
    const { enforceRateLimit, RateLimitError } = await loadWeighted()
    await enforceRateLimit('user-1', 'generate-minute', 5, 60, undefined, 4)
    await expect(enforceRateLimit('user-1', 'generate-minute', 5, 60, undefined, 2)).rejects.toThrow(RateLimitError)
    vi.doUnmock('firebase-admin/firestore')
  })

  it('rejects a weight larger than the remaining budget without incrementing', async () => {
    const { enforceRateLimit } = await loadWeighted()
    await enforceRateLimit('user-1', 'generate-minute', 5, 60, undefined, 4)
    await expect(enforceRateLimit('user-1', 'generate-minute', 5, 60, undefined, 2)).rejects.toThrow()
    await expect(enforceRateLimit('user-1', 'generate-minute', 5, 60, undefined, 1)).resolves.toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
  })

  it('defaults to a single unit and rejects a non-positive or fractional weight', async () => {
    const { enforceRateLimit } = await loadWeighted()
    await enforceRateLimit('user-9', 'generate-minute', 2, 60)
    await expect(enforceRateLimit('user-9', 'generate-minute', 2, 60, undefined, 0)).rejects.toThrow('positive integer')
    await expect(enforceRateLimit('user-9', 'generate-minute', 2, 60, undefined, 1.5)).rejects.toThrow('positive integer')
    vi.doUnmock('firebase-admin/firestore')
  })
})
