import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { GenerationLockedError, isGenerationLockStale, requireOwnedProject } from './persistence.js'
import { VARIATION_CANDIDATE_COUNT, VARIATION_FINALIST_COUNT, type GradingMode, type TokenUsage } from './variation-types.js'
import type { VariationDisplayName } from '../shared/protocol.js'

export class VariationSelectionConflictError extends Error {
  constructor(message = 'This project changed in another tab, so the comparison is out of date. Reload before choosing a direction.') {
    super(message)
  }
}

export type PersistableFinalist = {
  candidateId: string
  internalRank: number
  displayName: VariationDisplayName
  summary: string
  files: Record<string, string>
  standout: string
  scoreBreakdown: Record<string, number>
  model: string
  usage: TokenUsage
}

export type PersistVariationFinalistsInput = {
  uid: string
  projectId: string
  variationSetId: string
  generationId: string
  prompt: string
  baseSnapshotId?: string
  model: string
  gradingMode: GradingMode
  eligibleCount: number
  aggregateUsage: TokenUsage
  finalists: PersistableFinalist[]
}

export type VariationFinalistPayload = {
  candidateId: string
  displayName: VariationDisplayName
  summary: string
  files: Record<string, string>
  standout: string
}

export type VariationSetPayload = {
  variationSetId: string
  status: 'ready' | 'selected' | 'failed' | 'cancelled'
  gradingMode: GradingMode
  prompt: string
  baseSnapshotId?: string
  initialSelectedCandidateId?: string
  activeCandidateId?: string
  finalists: VariationFinalistPayload[]
}

const FINALISTS_READY_MESSAGE = 'Two directions are ready. Compare them and pick the one you want to keep building.'

function variationSetReference(projectReference: FirebaseFirestore.DocumentReference, variationSetId: string) {
  return projectReference.collection('variationSets').doc(variationSetId)
}

/**
 * Writes one variation-set document plus exactly two candidate documents, and points the project at
 * the pending set in the same commit. Discarded candidates — their IDs, briefs, grades, and code —
 * are never written anywhere.
 */
export async function persistVariationFinalists(input: PersistVariationFinalistsInput) {
  if (input.finalists.length !== VARIATION_FINALIST_COUNT) {
    throw new Error(`A variation set persists exactly ${VARIATION_FINALIST_COUNT} finalists.`)
  }
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  const setReference = variationSetReference(projectReference, input.variationSetId)
  const batch = getFirestore().batch()
  const now = Timestamp.now()

  batch.set(setReference, {
    prompt: input.prompt,
    generationId: input.generationId,
    ...(input.baseSnapshotId ? { baseSnapshotId: input.baseSnapshotId } : {}),
    status: 'ready',
    requestedCount: VARIATION_CANDIDATE_COUNT,
    eligibleCount: input.eligibleCount,
    gradingMode: input.gradingMode,
    model: input.model,
    aggregateUsage: input.aggregateUsage,
    createdAt: now,
  })

  for (const finalist of input.finalists) {
    batch.set(setReference.collection('candidates').doc(finalist.candidateId), {
      internalRank: finalist.internalRank,
      displayName: finalist.displayName,
      summary: finalist.summary,
      files: finalist.files,
      standout: finalist.standout,
      scoreBreakdown: finalist.scoreBreakdown,
      model: finalist.model,
      usage: finalist.usage,
      createdAt: now,
    })
  }

  batch.set(projectReference.collection('messages').doc(`${input.generationId}-assistant`), {
    role: 'assistant',
    content: FINALISTS_READY_MESSAGE,
    generationId: input.generationId,
    variationSetId: input.variationSetId,
    createdAt: now,
  })

  batch.update(projectReference, {
    pendingVariationSetId: input.variationSetId,
    updatedAt: FieldValue.serverTimestamp(),
  })

  await batch.commit()
}

export async function loadVariationSet(uid: string, projectId: string, variationSetId: string): Promise<VariationSetPayload> {
  const projectReference = await requireOwnedProject(uid, projectId)
  const setReference = variationSetReference(projectReference, variationSetId)
  const [set, candidates] = await Promise.all([setReference.get(), setReference.collection('candidates').get()])
  if (!set.exists) throw new Error('That comparison was not found.')

  return {
    variationSetId,
    status: (set.get('status') as VariationSetPayload['status']) ?? 'ready',
    gradingMode: (set.get('gradingMode') as GradingMode) ?? 'full',
    prompt: (set.get('prompt') as string) ?? '',
    baseSnapshotId: set.get('baseSnapshotId') as string | undefined,
    initialSelectedCandidateId: set.get('initialSelectedCandidateId') as string | undefined,
    activeCandidateId: set.get('activeCandidateId') as string | undefined,
    // Internal rank and score breakdowns stay server-side: the comparison is deliberately
    // equal-weight and shows no raw scores or recommendation.
    finalists: candidates.docs.map((document) => ({
      candidateId: document.id,
      displayName: document.get('displayName') as VariationDisplayName,
      summary: (document.get('summary') as string) ?? '',
      files: (document.get('files') as Record<string, string>) ?? {},
      standout: (document.get('standout') as string) ?? '',
    })),
  }
}

export async function selectVariationFinalist(input: {
  uid: string
  projectId: string
  variationSetId: string
  candidateId: string
}): Promise<{ snapshotId: string; files: Record<string, string> }> {
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  const setReference = variationSetReference(projectReference, input.variationSetId)
  const candidateReference = setReference.collection('candidates').doc(input.candidateId)
  // Read outside the transaction only for the pre-switch backup; every mutation below is atomic.
  const currentFiles = await projectReference.collection('files').get()
  const activeFiles = Object.fromEntries(currentFiles.docs.map((document) => [document.get('path') as string, document.get('content') as string]))

  return getFirestore().runTransaction(async (transaction) => {
    const [project, set, candidate] = await Promise.all([
      transaction.get(projectReference),
      transaction.get(setReference),
      transaction.get(candidateReference),
    ])
    if (!set.exists) throw new Error('That comparison was not found.')
    if (!candidate.exists) throw new Error('That option is no longer available.')
    const status = set.get('status') as VariationSetPayload['status']
    if (status === 'cancelled' || status === 'failed') throw new Error('That comparison is no longer available.')

    const files = (candidate.get('files') as Record<string, string> | undefined) ?? {}
    const promotedSnapshotId = candidate.get('promotedSnapshotId') as string | undefined
    const activeCandidateId = set.get('activeCandidateId') as string | undefined
    // An identical retry must return the snapshot it already created rather than making another.
    if (activeCandidateId === input.candidateId && promotedSnapshotId) {
      return { snapshotId: promotedSnapshotId, files }
    }

    const initialSelectedCandidateId = set.get('initialSelectedCandidateId') as string | undefined
    const isInitialSelection = !initialSelectedCandidateId
    if (isInitialSelection) {
      const baseSnapshotId = set.get('baseSnapshotId') as string | undefined
      const latestSnapshotId = project.get('latestSnapshotId') as string | undefined
      if ((baseSnapshotId ?? undefined) !== (latestSnapshotId ?? undefined)) throw new VariationSelectionConflictError()
    } else {
      const lock = project.get('generationLock') as { generationId?: string; startedAt?: Timestamp } | undefined
      if (lock?.startedAt && !isGenerationLockStale(lock.startedAt)) {
        throw new GenerationLockedError('A generation is running for this project. Wait for it to finish before switching directions.')
      }
    }

    const now = Timestamp.now()
    const snapshotReference = projectReference.collection('snapshots').doc()
    const generationId = (set.get('generationId') as string | undefined) ?? snapshotReference.id
    const summary = (candidate.get('summary') as string) ?? ''

    if (!isInitialSelection && Object.keys(activeFiles).length) {
      transaction.set(projectReference.collection('snapshots').doc(), {
        prompt: '',
        summary: 'Backup created automatically before switching directions.',
        files: activeFiles,
        provider: 'manual',
        kind: 'backup',
        createdAt: now,
      })
    }

    transaction.set(snapshotReference, {
      generationId,
      prompt: (set.get('prompt') as string) ?? '',
      summary,
      files,
      provider: 'openai',
      model: (candidate.get('model') as string) ?? (set.get('model') as string) ?? 'unknown',
      kind: 'generation',
      variationSetId: input.variationSetId,
      variationCandidateId: input.candidateId,
      createdAt: now,
    })

    for (const [path, content] of Object.entries(files)) {
      transaction.set(projectReference.collection('files').doc(path), { path, content, updatedAt: now })
    }

    transaction.set(projectReference.collection('messages').doc(`${generationId}-${input.candidateId}-assistant`), {
      role: 'assistant',
      content: summary,
      generationId,
      variationSetId: input.variationSetId,
      variationCandidateId: input.candidateId,
      createdAt: Timestamp.fromMillis(now.toMillis() + 1),
    })

    transaction.update(candidateReference, { promotedSnapshotId: snapshotReference.id })
    transaction.update(setReference, {
      status: 'selected',
      ...(isInitialSelection ? { initialSelectedCandidateId: input.candidateId } : {}),
      activeCandidateId: input.candidateId,
      selectedAt: now,
    })
    transaction.update(projectReference, {
      latestSnapshotId: snapshotReference.id,
      updatedAt: FieldValue.serverTimestamp(),
      // Only clear the pointer while it still references this set.
      ...(project.get('pendingVariationSetId') === input.variationSetId ? { pendingVariationSetId: FieldValue.delete() } : {}),
    })

    return { snapshotId: snapshotReference.id, files }
  })
}

/** Marks a set terminal and releases the pending pointer only when it still references that set. */
export async function closeVariationSet(
  uid: string,
  projectId: string,
  variationSetId: string,
  status: 'failed' | 'cancelled',
) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const setReference = variationSetReference(projectReference, variationSetId)
  await getFirestore().runTransaction(async (transaction) => {
    const [project, set] = await Promise.all([transaction.get(projectReference), transaction.get(setReference)])
    if (set.exists) transaction.update(setReference, { status })
    if (project.get('pendingVariationSetId') === variationSetId) {
      transaction.update(projectReference, { pendingVariationSetId: FieldValue.delete() })
    }
  })
}
