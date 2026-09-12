import { describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { isGenerationLockStale } from './persistence.js'

type FakeDoc = { data: Record<string, unknown> }

function applyPatch(data: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && value.constructor?.name === 'DeleteTransform') {
      delete data[key]
    } else {
      data[key] = value
    }
  }
}

function makeFakeFirestore(initialProject: Record<string, unknown>) {
  const project: FakeDoc = { data: { ...initialProject } }
  const documentReference = {
    get: async () => ({
      exists: true,
      get: (key: string) => project.data[key],
      data: () => project.data,
    }),
    update: async (patch: Record<string, unknown>) => applyPatch(project.data, patch),
  }
  const firestore = {
    collection: () => ({ doc: () => documentReference }),
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: async (reference: typeof documentReference) => reference.get(),
      update: (reference: typeof documentReference, patch: Record<string, unknown>) => applyPatch(project.data, patch),
    }),
  }
  return { firestore, project }
}

describe('generation lock staleness', () => {
  it('treats a fresh lock as active', () => {
    const startedAt = Timestamp.now()
    expect(isGenerationLockStale(startedAt, startedAt)).toBe(false)
  })

  it('treats a lock older than 6 minutes as stale', () => {
    const startedAt = Timestamp.now()
    const later = Timestamp.fromMillis(startedAt.toMillis() + 7 * 60_000)
    expect(isGenerationLockStale(startedAt, later)).toBe(true)
  })
})

describe('acquireGenerationLock / releaseGenerationLock', () => {
  it('rejects a second acquire while a fresh lock is held, and allows one once released', async () => {
    const { firestore, project } = makeFakeFirestore({ ownerId: 'user-1' })
    vi.resetModules()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { acquireGenerationLock, releaseGenerationLock, GenerationLockedError } = await import('./persistence.js')

    await acquireGenerationLock('user-1', 'project-1', 'gen-1')
    expect(project.data.generationLock).toMatchObject({ generationId: 'gen-1' })

    await expect(acquireGenerationLock('user-1', 'project-1', 'gen-2')).rejects.toThrow(GenerationLockedError)

    await releaseGenerationLock('user-1', 'project-1', 'gen-1')
    expect(project.data.generationLock).toBeUndefined()

    await expect(acquireGenerationLock('user-1', 'project-1', 'gen-3')).resolves.toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
    vi.resetModules()
  })

  it('does not release a lock owned by a newer generation', async () => {
    const { firestore, project } = makeFakeFirestore({
      ownerId: 'user-1',
      generationLock: { generationId: 'gen-2', startedAt: Timestamp.now() },
    })
    vi.resetModules()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { releaseGenerationLock } = await import('./persistence.js')

    await releaseGenerationLock('user-1', 'project-1', 'gen-1')
    expect(project.data.generationLock).toMatchObject({ generationId: 'gen-2' })
    vi.doUnmock('firebase-admin/firestore')
    vi.resetModules()
  })

  it('records cancellation by generation ID without disturbing another lock', async () => {
    const { firestore, project } = makeFakeFirestore({
      ownerId: 'user-1',
      generationLock: { generationId: 'gen-1', startedAt: Timestamp.now() },
    })
    vi.resetModules()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { requestGenerationCancellation } = await import('./persistence.js')

    await expect(requestGenerationCancellation('user-1', 'project-1', 'gen-2')).resolves.toEqual({ status: 'not_running' })
    expect(project.data.generationLock).toMatchObject({ generationId: 'gen-1' })
    expect(project.data.generationCancellation).toMatchObject({ generationId: 'gen-2', requestedAt: expect.any(Timestamp) })

    await expect(requestGenerationCancellation('user-1', 'project-1', 'gen-1')).resolves.toEqual({ status: 'cancel_requested' })
    expect(project.data.generationCancellation).toMatchObject({ generationId: 'gen-1', requestedAt: expect.any(Timestamp) })
    vi.doUnmock('firebase-admin/firestore')
    vi.resetModules()
  })

  it('preserves an early cancellation until that generation starts, then cleans it up on release', async () => {
    const { firestore, project } = makeFakeFirestore({ ownerId: 'user-1' })
    vi.resetModules()
    vi.doMock('firebase-admin/firestore', async () => {
      const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
      return { ...actual, getFirestore: () => firestore }
    })
    const { acquireGenerationLock, releaseGenerationLock, requestGenerationCancellation } = await import('./persistence.js')

    await expect(requestGenerationCancellation('user-1', 'project-1', 'gen-1')).resolves.toEqual({ status: 'not_running' })
    await acquireGenerationLock('user-1', 'project-1', 'gen-1')
    expect(project.data.generationCancellation).toMatchObject({ generationId: 'gen-1' })

    await releaseGenerationLock('user-1', 'project-1', 'gen-1')
    expect(project.data.generationLock).toBeUndefined()
    expect(project.data.generationCancellation).toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
    vi.resetModules()
  })
})
