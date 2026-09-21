import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { GeneratedApplication } from './application.js'

export type GenerationContext = {
  project: {
    name: string
    description: string
    locationId: string | null
  }
  files: Record<string, string>
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The snapshot the caller's workspace is based on; a variation set records it to detect stale selections. */
  latestSnapshotId?: string
}

export class GenerationLockedError extends Error {}

const GENERATION_LOCK_STALE_MS = 6 * 60_000

type GenerationLock = {
  generationId?: string
  startedAt?: Timestamp
}

type GenerationCancellation = {
  generationId?: string
  requestedAt?: Timestamp
}

export function isGenerationLockStale(startedAt: Timestamp, now = Timestamp.now()): boolean {
  return now.toMillis() - startedAt.toMillis() > GENERATION_LOCK_STALE_MS
}

/**
 * Guards against two concurrent generations on the same project (double-submit, two tabs):
 * without this, both would burn rate-limit budget and money, and whichever finishes last would
 * silently overwrite the other's files.
 */
export async function acquireGenerationLock(uid: string, projectId: string, generationId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(projectReference)
    const lock = snapshot.get('generationLock') as GenerationLock | undefined
    if (lock?.startedAt && !isGenerationLockStale(lock.startedAt)) {
      throw new GenerationLockedError('A generation is already running for this project. Wait for it to finish, or stop it, before starting another.')
    }
    transaction.update(projectReference, { generationLock: { generationId, startedAt: Timestamp.now() } })
  })
}

export async function releaseGenerationLock(uid: string, projectId: string, generationId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(projectReference)
    const lock = snapshot.get('generationLock') as GenerationLock | undefined
    const cancellation = snapshot.get('generationCancellation') as GenerationCancellation | undefined
    const updates: Record<string, unknown> = {}
    if (lock?.generationId === generationId) updates.generationLock = FieldValue.delete()
    if (cancellation?.generationId === generationId) updates.generationCancellation = FieldValue.delete()
    if (Object.keys(updates).length) transaction.update(projectReference, updates)
  })
}

export async function requestGenerationCancellation(uid: string, projectId: string, generationId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(projectReference)
    const lock = snapshot.get('generationLock') as GenerationLock | undefined
    const isMatchingActiveLock = lock?.generationId === generationId
      && (!lock.startedAt || !isGenerationLockStale(lock.startedAt))
    transaction.update(projectReference, {
      ...(lock?.generationId === generationId && lock.startedAt && isGenerationLockStale(lock.startedAt)
        ? { generationLock: FieldValue.delete() }
        : {}),
      generationCancellation: { generationId, requestedAt: Timestamp.now() },
    })
    return { status: isMatchingActiveLock ? 'cancel_requested' as const : 'not_running' as const }
  })
}

export async function observeGenerationCancellation(
  uid: string,
  projectId: string,
  generationId: string,
  onCancel: () => void,
  onError: (error: Error) => void,
) {
  const projectReference = await requireOwnedProject(uid, projectId)
  return projectReference.onSnapshot((snapshot) => {
    const cancellation = snapshot.get('generationCancellation') as GenerationCancellation | undefined
    if (cancellation?.generationId === generationId && cancellation.requestedAt) onCancel()
  }, onError)
}

export async function persistUserMessage(input: { uid: string; projectId: string; prompt: string; generationId: string }) {
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  await projectReference.collection('messages').doc(`${input.generationId}-user`).set({
    role: 'user',
    content: input.prompt,
    generationId: input.generationId,
    createdAt: Timestamp.now(),
  })
}

export async function requireOwnedProject(uid: string, projectId: string) {
  const reference = getFirestore().collection('projects').doc(projectId)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.get('ownerId') !== uid || snapshot.get('deletedAt')) {
    throw new Error('Project was not found.')
  }
  return reference
}

export async function loadGenerationContext(uid: string, projectId: string): Promise<GenerationContext> {
  const projectReference = await requireOwnedProject(uid, projectId)
  const [project, currentFiles, messages] = await Promise.all([
    projectReference.get(),
    projectReference.collection('files').get(),
    projectReference.collection('messages').orderBy('createdAt', 'asc').limitToLast(12).get(),
  ])
  const latestSnapshotId = project.get('latestSnapshotId') as string | undefined
  const latestSnapshot = currentFiles.empty && latestSnapshotId
    ? await projectReference.collection('snapshots').doc(latestSnapshotId).get()
    : undefined
  const files = currentFiles.empty
    ? (latestSnapshot?.get('files') as Record<string, string> | undefined) ?? {}
    : Object.fromEntries(currentFiles.docs.map((document) => [document.get('path'), document.get('content')]))

  return {
    project: {
      name: String(project.get('name') ?? '').slice(0, 120),
      description: String(project.get('description') ?? '').slice(0, 2_000),
      locationId: typeof project.get('locationId') === 'string' ? project.get('locationId') : null,
    },
    latestSnapshotId,
    files,
    recentMessages: messages.docs.flatMap((document) => {
      const role = document.get('role')
      const content = document.get('content')
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return []
      return [{ role, content: content.slice(0, 2_000) }]
    }),
  }
}

export async function persistGeneration(input: {
  uid: string
  projectId: string
  prompt: string
  application: GeneratedApplication
  generationId: string
  snapshotId: string
  provider: 'openai'
  model: string
}) {
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  const db = getFirestore()
  const batch = db.batch()
  const messages = projectReference.collection('messages')
  const snapshotReference = projectReference.collection('snapshots').doc(input.snapshotId)
  const now = Timestamp.now()

  batch.set(messages.doc(`${input.generationId}-assistant`), { role: 'assistant', content: input.application.summary, generationId: input.generationId, createdAt: now })
  batch.set(snapshotReference, {
    generationId: input.generationId,
    prompt: input.prompt,
    summary: input.application.summary,
    files: Object.fromEntries(input.application.files.map((file) => [file.path, file.content])),
    provider: input.provider,
    model: input.model,
    createdAt: now,
  })
  for (const file of input.application.files) {
    batch.set(projectReference.collection('files').doc(file.path), {
      path: file.path,
      content: file.content,
      updatedAt: now,
    })
  }
  batch.update(projectReference, { latestSnapshotId: input.snapshotId, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()
}

export async function persistPartialGeneration(input: {
  projectId: string
  prompt: string
  generationId: string
  summary: string
  files: Record<string, string>
  uid: string
  provider: 'openai'
  model: string
}) {
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  const batch = getFirestore().batch()
  const now = Timestamp.now()
  const summary = input.summary || 'Generation stopped before the response completed.'
  const messages = projectReference.collection('messages')
  batch.set(messages.doc(`${input.generationId}-assistant`), {
    role: 'assistant',
    content: summary,
    generationId: input.generationId,
    interrupted: true,
    createdAt: Timestamp.fromMillis(now.toMillis() + 1),
  })
  if (Object.keys(input.files).length) {
    batch.set(projectReference.collection('snapshots').doc(), {
      generationId: input.generationId,
      prompt: input.prompt,
      summary,
      files: input.files,
      provider: input.provider,
      model: input.model,
      kind: 'partial',
      createdAt: now,
    })
  }
  await batch.commit()
}

export async function loadProjectState(uid: string, projectId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const [project, messages, currentFiles] = await Promise.all([
    projectReference.get(),
    projectReference.collection('messages').orderBy('createdAt', 'asc').limitToLast(80).get(),
    projectReference.collection('files').get(),
  ])
  const snapshotId = project.get('latestSnapshotId') as string | undefined
  const snapshot = snapshotId ? await projectReference.collection('snapshots').doc(snapshotId).get() : undefined
  return {
    snapshotId: snapshot?.id,
    // Lets a reload restore comparison mode without listing or scanning historical variation sets.
    pendingVariationSetId: project.get('pendingVariationSetId') as string | undefined,
    files: currentFiles.empty
      ? snapshot?.get('files') ?? null
      : Object.fromEntries(currentFiles.docs.map((document) => [document.get('path'), document.get('content')])),
    messages: messages.docs.map((document) => ({
      id: document.id,
      role: document.get('role'),
      content: document.get('content'),
    })),
  }
}

export async function listProjectSnapshots(uid: string, projectId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const snapshots = await projectReference.collection('snapshots').orderBy('createdAt', 'desc').limit(50).get()
  return snapshots.docs.map((document) => ({
    id: document.id,
    // Present only on a snapshot promoted from a variation finalist, so history can reopen the
    // comparison; ordinary snapshots omit both fields.
    variationSetId: document.get('variationSetId') as string | undefined,
    variationCandidateId: document.get('variationCandidateId') as string | undefined,
    generationId: document.get('generationId'),
    prompt: document.get('prompt') ?? '',
    summary: document.get('summary') ?? '',
    label: document.get('label') ?? '',
    provider: document.get('provider') ?? 'unknown',
    model: document.get('model'),
    kind: document.get('kind') ?? 'generation',
    fileCount: Object.keys(document.get('files') ?? {}).length,
    createdAt: document.get('createdAt')?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  }))
}

export async function loadSnapshotFiles(uid: string, projectId: string, snapshotId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const snapshot = await projectReference.collection('snapshots').doc(snapshotId).get()
  if (!snapshot.exists) throw new Error('Snapshot was not found.')
  return { files: (snapshot.get('files') as Record<string, string> | undefined) ?? {} }
}

const snapshotEditableFields = { message: 'label', description: 'summary' } as const
export type SnapshotEditableField = keyof typeof snapshotEditableFields

export async function updateSnapshotField(uid: string, projectId: string, snapshotId: string, field: SnapshotEditableField, value: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const snapshotReference = projectReference.collection('snapshots').doc(snapshotId)
  const snapshot = await snapshotReference.get()
  if (!snapshot.exists) throw new Error('Snapshot was not found.')
  const key = snapshotEditableFields[field]
  await snapshotReference.update({ [key]: field === 'message' ? (value || FieldValue.delete()) : value })
  return { id: snapshotId, field, value }
}

export async function saveProjectFiles(uid: string, projectId: string, files: Record<string, string>) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const batch = getFirestore().batch()
  const now = Timestamp.now()
  const snapshotReference = projectReference.collection('snapshots').doc()
  for (const [path, content] of Object.entries(files)) {
    batch.set(projectReference.collection('files').doc(path), { path, content, updatedAt: now })
  }
  batch.set(snapshotReference, {
    prompt: '',
    summary: 'Manual edit',
    files,
    provider: 'manual',
    kind: 'manual',
    createdAt: now,
  })
  batch.update(projectReference, { latestSnapshotId: snapshotReference.id, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()
  return { snapshotId: snapshotReference.id }
}

export async function restoreProjectSnapshot(uid: string, projectId: string, snapshotId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const [snapshot, currentFiles] = await Promise.all([
    projectReference.collection('snapshots').doc(snapshotId).get(),
    projectReference.collection('files').get(),
  ])
  if (!snapshot.exists) throw new Error('Snapshot was not found.')
  const files = snapshot.get('files') as Record<string, string> | undefined
  if (!files || !Object.keys(files).length) throw new Error('Snapshot contains no files.')
  const batch = getFirestore().batch()
  const now = Timestamp.now()
  const current = Object.fromEntries(currentFiles.docs.map((document) => [document.get('path'), document.get('content')]))
  const backupReference = projectReference.collection('snapshots').doc()
  if (Object.keys(current).length) {
    batch.set(backupReference, {
      prompt: '',
      summary: 'Backup created automatically before restoring a snapshot.',
      files: current,
      provider: 'manual',
      kind: 'backup',
      createdAt: now,
    })
  }
  for (const [path, content] of Object.entries(files)) {
    batch.set(projectReference.collection('files').doc(path), { path, content, updatedAt: now })
  }
  batch.update(projectReference, { latestSnapshotId: snapshotId, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()
  return { snapshotId, files, backupSnapshotId: Object.keys(current).length ? backupReference.id : undefined }
}
