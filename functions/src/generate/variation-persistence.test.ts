import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'

/**
 * Minimal in-memory Firestore double. Documents are keyed by full path so nested collections,
 * transactions, and batches all operate on one store, which is what the variation flow needs to
 * assert (exactly two candidate documents, one pending pointer, snapshot counts).
 */
function makeFakeFirestore() {
  const documents = new Map<string, Record<string, unknown>>()
  let autoId = 0

  function applyPatch(path: string, patch: Record<string, unknown>, merge: boolean) {
    const current = merge ? { ...(documents.get(path) ?? {}) } : {}
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && value.constructor?.name === 'DeleteTransform') delete current[key]
      else if (value && typeof value === 'object' && value.constructor?.name === 'ServerTimestampTransform') current[key] = Timestamp.now()
      else current[key] = value
    }
    documents.set(path, current)
  }

  function snapshotOf(path: string) {
    const data = documents.get(path)
    return {
      id: path.split('/').pop()!,
      exists: data !== undefined,
      ref: makeDoc(path),
      get: (key: string) => data?.[key],
      data: () => data,
    }
  }

  function makeDoc(path: string): any {
    return {
      id: path.split('/').pop()!,
      path,
      collection: (name: string) => makeCollection(`${path}/${name}`),
      get: async () => snapshotOf(path),
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => applyPatch(path, data, Boolean(options?.merge)),
      update: async (data: Record<string, unknown>) => applyPatch(path, data, true),
      delete: async () => { documents.delete(path) },
    }
  }

  function childDocs(collectionPath: string) {
    return [...documents.keys()]
      .filter((path) => path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/'))
      .map((path) => snapshotOf(path))
  }

  function makeCollection(collectionPath: string): any {
    const query = {
      orderBy: () => query,
      limit: () => query,
      limitToLast: () => query,
      where: () => query,
      get: async () => {
        const docs = childDocs(collectionPath)
        return { docs, empty: docs.length === 0, size: docs.length }
      },
    }
    return {
      ...query,
      doc: (id?: string) => makeDoc(`${collectionPath}/${id ?? `auto-${++autoId}`}`),
    }
  }

  const firestore = {
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const operations: Array<() => void> = []
      return {
        set: (reference: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
          operations.push(() => applyPatch(reference.path, data, Boolean(options?.merge))),
        update: (reference: { path: string }, data: Record<string, unknown>) =>
          operations.push(() => applyPatch(reference.path, data, true)),
        delete: (reference: { path: string }) => operations.push(() => { documents.delete(reference.path) }),
        commit: async () => { for (const operation of operations) operation() },
      }
    },
    runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      get: async (reference: { path: string }) => snapshotOf(reference.path),
      set: (reference: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) =>
        applyPatch(reference.path, data, Boolean(options?.merge)),
      update: (reference: { path: string }, data: Record<string, unknown>) => applyPatch(reference.path, data, true),
      delete: (reference: { path: string }) => { documents.delete(reference.path) },
    }),
  }

  return { firestore, documents, snapshotOf }
}

const files = {
  'index.html': '<div id="app"></div>',
  'styles.css': ':root { color-scheme: dark; }',
  'app.js': 'console.log(1)',
}

function finalist(candidateId: string, rank: 1 | 2, displayName: 'Direction A' | 'Direction B') {
  return {
    candidateId,
    internalRank: rank,
    displayName,
    summary: `Summary for ${candidateId}`,
    files: { ...files, 'app.js': `// ${candidateId}` },
    standout: 'Clear hierarchy over the other response.',
    scoreBreakdown: { featureFidelity: 28 },
    model: 'gpt-5.4-mini',
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    brief: {
      id: candidateId,
      title: `Direction for ${candidateId}`,
      designIntent: 'A clear, hierarchy-first layout.',
      informationArchitecture: 'Single column with a sticky summary.',
      interactionModel: 'Click-through cards.',
      visualDirection: 'Warm neutral palette.',
      density: 'balanced' as const,
      differentiators: ['Sticky summary', 'Card-based navigation', 'Warm palette'],
    },
  }
}

const persistInput = {
  uid: 'user-1',
  projectId: 'project-1',
  variationSetId: 'set-1',
  generationId: 'generation-1',
  prompt: 'Show me a few directions',
  baseSnapshotId: 'base-snapshot',
  model: 'gpt-5.4-mini',
  gradingMode: 'full' as const,
  eligibleCount: 4,
  aggregateUsage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
  finalists: [finalist('candidate-a', 1, 'Direction A'), finalist('candidate-b', 2, 'Direction B')],
}

const selection = {
  uid: 'user-1',
  projectId: 'project-1',
  variationSetId: 'set-1',
  candidateId: 'candidate-a',
}

let fake: ReturnType<typeof makeFakeFirestore>

async function loadModule() {
  vi.resetModules()
  vi.doMock('firebase-admin/firestore', async () => {
    const actual = await vi.importActual<typeof import('firebase-admin/firestore')>('firebase-admin/firestore')
    return { ...actual, getFirestore: () => fake.firestore }
  })
  return import('./variation-persistence.js')
}

function project() {
  return fake.documents.get('projects/project-1') ?? {}
}

function variationSet() {
  return fake.documents.get('projects/project-1/variationSets/set-1') ?? {}
}

function candidateDocumentPaths() {
  return [...fake.documents.keys()].filter((path) => path.includes('/candidates/'))
}

function snapshotPaths() {
  return [...fake.documents.keys()].filter((path) => /^projects\/project-1\/snapshots\/[^/]+$/.test(path))
}

function activeFiles() {
  return Object.fromEntries([...fake.documents.entries()]
    .filter(([path]) => path.startsWith('projects/project-1/files/'))
    .map(([, data]) => [data.path as string, data.content as string]))
}

beforeEach(() => {
  fake = makeFakeFirestore()
  fake.documents.set('projects/project-1', {
    ownerId: 'user-1',
    name: 'CRM',
    latestSnapshotId: 'base-snapshot',
  })
  fake.documents.set('projects/project-1/snapshots/base-snapshot', {
    prompt: 'Earlier',
    summary: 'Earlier build',
    files,
    createdAt: Timestamp.now(),
  })
  for (const [path, content] of Object.entries(files)) {
    fake.documents.set(`projects/project-1/files/${path}`, { path, content, updatedAt: Timestamp.now() })
  }
})

describe('persistVariationFinalists', () => {
  it('persists code for exactly two finalists', async () => {
    const { persistVariationFinalists } = await loadModule()
    await persistVariationFinalists(persistInput)
    expect(candidateDocumentPaths()).toHaveLength(2)
    expect(project().pendingVariationSetId).toBe('set-1')
    expect(variationSet()).toMatchObject({ status: 'ready', requestedCount: 4, gradingMode: 'full', eligibleCount: 4 })
  })

  it('never writes discarded candidates, only the two persisted finalists', async () => {
    const { persistVariationFinalists } = await loadModule()
    await persistVariationFinalists(persistInput)
    const candidateIds = candidateDocumentPaths().map((path) => path.split('/').pop())
    expect(candidateIds.sort()).toEqual(['candidate-a', 'candidate-b'])
    expect(variationSet()).not.toHaveProperty('candidates')
  })

  it('records one assistant message stating that two directions are ready', async () => {
    const { persistVariationFinalists } = await loadModule()
    await persistVariationFinalists(persistInput)
    const messages = [...fake.documents.entries()].filter(([path]) => path.includes('/messages/'))
    expect(messages).toHaveLength(1)
    expect(String(messages[0]?.[1].content)).toMatch(/two directions/i)
  })
})

describe('loadVariationSet', () => {
  it('returns both finalists to the owner along with their scores, rank, and brief for transparency', async () => {
    const { persistVariationFinalists, loadVariationSet } = await loadModule()
    await persistVariationFinalists(persistInput)
    const payload = await loadVariationSet('user-1', 'project-1', 'set-1')
    expect(payload.finalists).toHaveLength(2)
    expect(payload.finalists.map((entry) => entry.candidateId).sort()).toEqual(['candidate-a', 'candidate-b'])
    expect(payload.finalists[0]).toMatchObject({
      scoreBreakdown: { featureFidelity: 28 },
      internalRank: 1,
      brief: { id: 'candidate-a' },
    })
    expect(payload.requestedCount).toBe(4)
    expect(payload.eligibleCount).toBe(4)
    expect(payload.variationSetId).toBe('set-1')
  })

  it('refuses a variation set on a project the caller does not own', async () => {
    const { persistVariationFinalists, loadVariationSet } = await loadModule()
    await persistVariationFinalists(persistInput)
    await expect(loadVariationSet('user-2', 'project-1', 'set-1')).rejects.toThrow('Project was not found.')
  })
})

describe('selectVariationFinalist', () => {
  it('promotes the chosen finalist atomically and clears the pending pointer', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    await persistVariationFinalists(persistInput)
    const result = await selectVariationFinalist(selection)

    expect(activeFiles()['app.js']).toBe('// candidate-a')
    expect(result.files['app.js']).toBe('// candidate-a')
    expect(project().latestSnapshotId).toBe(result.snapshotId)
    expect(project().pendingVariationSetId).toBeUndefined()
    expect(variationSet()).toMatchObject({
      status: 'selected',
      initialSelectedCandidateId: 'candidate-a',
      activeCandidateId: 'candidate-a',
    })
  })

  it('is idempotent for an identical retry', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    await persistVariationFinalists(persistInput)
    const first = await selectVariationFinalist(selection)
    const before = snapshotPaths().length
    const second = await selectVariationFinalist(selection)
    expect(second.snapshotId).toBe(first.snapshotId)
    expect(snapshotPaths()).toHaveLength(before)
  })

  it('rejects initial selection after the base snapshot changes', async () => {
    const { persistVariationFinalists, selectVariationFinalist, VariationSelectionConflictError } = await loadModule()
    await persistVariationFinalists(persistInput)
    const originalFiles = activeFiles()
    await fake.firestore.collection('projects').doc('project-1').update({ latestSnapshotId: 'newer-snapshot' })

    await expect(selectVariationFinalist(selection)).rejects.toThrow(VariationSelectionConflictError)
    expect(activeFiles()).toEqual(originalFiles)
  })

  it('rejects a candidate that is not one of the set finalists', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    await persistVariationFinalists(persistInput)
    await expect(selectVariationFinalist({ ...selection, candidateId: 'candidate-z' }))
      .rejects.toThrow('That option is no longer available.')
  })

  it('keeps the initial preference when switching later', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    await persistVariationFinalists(persistInput)
    await selectVariationFinalist({ ...selection, candidateId: 'candidate-a' })
    await selectVariationFinalist({ ...selection, candidateId: 'candidate-b' })

    expect(variationSet()).toMatchObject({
      initialSelectedCandidateId: 'candidate-a',
      activeCandidateId: 'candidate-b',
    })
    expect(activeFiles()['app.js']).toBe('// candidate-b')
    // initial promotion, backup, switched promotion
    expect(snapshotPaths().filter((path) => !path.endsWith('base-snapshot'))).toHaveLength(3)
  })

  it('refuses a later switch while another generation lock is active', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    const { GenerationLockedError } = await import('./persistence.js')
    await persistVariationFinalists(persistInput)
    await selectVariationFinalist({ ...selection, candidateId: 'candidate-a' })
    await fake.firestore.collection('projects').doc('project-1').update({
      generationLock: { generationId: 'other-generation', startedAt: Timestamp.now() },
    })

    await expect(selectVariationFinalist({ ...selection, candidateId: 'candidate-b' })).rejects.toThrow(GenerationLockedError)
    expect(activeFiles()['app.js']).toBe('// candidate-a')
  })

  it('records variation linkage on the promoted snapshot', async () => {
    const { persistVariationFinalists, selectVariationFinalist } = await loadModule()
    await persistVariationFinalists(persistInput)
    const result = await selectVariationFinalist(selection)
    expect(fake.documents.get(`projects/project-1/snapshots/${result.snapshotId}`)).toMatchObject({
      variationSetId: 'set-1',
      variationCandidateId: 'candidate-a',
    })
  })
})
