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

function makeReadOnlyFirestore(documents: Record<string, Record<string, unknown>>) {
  const snapshotOf = (path: string) => ({
    id: path.split('/').pop()!,
    exists: documents[path] !== undefined,
    get: (key: string) => documents[path]?.[key],
    data: () => documents[path],
  })
  const childDocs = (collectionPath: string) => Object.keys(documents)
    .filter((path) => path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/'))
    .map(snapshotOf)
  const makeCollection = (collectionPath: string): any => {
    const query: any = {
      orderBy: () => query,
      limit: () => query,
      limitToLast: () => query,
      where: () => query,
      get: async () => {
        const docs = childDocs(collectionPath)
        return { docs, empty: docs.length === 0 }
      },
    }
    query.doc = (id: string) => ({
      id,
      path: `${collectionPath}/${id}`,
      get: async () => snapshotOf(`${collectionPath}/${id}`),
      collection: (name: string) => makeCollection(`${collectionPath}/${id}/${name}`),
    })
    return query
  }
  return { collection: (name: string) => makeCollection(name) }
}

async function loadPersistenceWith(documents: Record<string, Record<string, unknown>>) {
  vi.resetModules()
  const firestore = makeReadOnlyFirestore(documents)
  vi.doMock('firebase-admin/firestore', async () => {
    const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
    return { ...actual, getFirestore: () => firestore }
  })
  return import('./persistence.js')
}

describe('project state and snapshot listing', () => {
  it('returns the pending variation set pointer with project state', async () => {
    const { loadProjectState } = await loadPersistenceWith({
      'projects/project-1': { ownerId: 'user-1', latestSnapshotId: 'snap-1', pendingVariationSetId: 'set-1' },
      'projects/project-1/snapshots/snap-1': { files: { 'app.js': 'x' } },
      'projects/project-1/files/app.js': { path: 'app.js', content: 'x' },
    })
    const state = await loadProjectState('user-1', 'project-1')
    expect(state.pendingVariationSetId).toBe('set-1')
    vi.doUnmock('firebase-admin/firestore')
  })

  it('omits the pointer when no variation set is pending', async () => {
    const { loadProjectState } = await loadPersistenceWith({
      'projects/project-1': { ownerId: 'user-1' },
    })
    expect((await loadProjectState('user-1', 'project-1')).pendingVariationSetId).toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
  })

  it('returns variation linkage in snapshot history and omits it from ordinary snapshots', async () => {
    const { listProjectSnapshots } = await loadPersistenceWith({
      'projects/project-1': { ownerId: 'user-1' },
      'projects/project-1/snapshots/snap-variation': {
        prompt: 'Show me a few directions',
        summary: 'Direction A',
        variationSetId: 'set-1',
        variationCandidateId: 'candidate-a',
      },
      'projects/project-1/snapshots/snap-plain': { prompt: 'Build it', summary: 'Built it' },
    })
    const snapshots = await listProjectSnapshots('user-1', 'project-1')
    const variationSnapshot = snapshots.find((snapshot) => snapshot.id === 'snap-variation')
    const plainSnapshot = snapshots.find((snapshot) => snapshot.id === 'snap-plain')
    expect(variationSnapshot).toMatchObject({ variationSetId: 'set-1', variationCandidateId: 'candidate-a' })
    expect(plainSnapshot?.variationSetId).toBeUndefined()
    expect(plainSnapshot?.variationCandidateId).toBeUndefined()
    vi.doUnmock('firebase-admin/firestore')
  })
})
