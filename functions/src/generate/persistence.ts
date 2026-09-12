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
    generationId: document.get('generationId'),
    prompt: document.get('prompt') ?? '',
    summary: document.get('summary') ?? '',
    provider: document.get('provider') ?? 'unknown',
    kind: document.get('kind') ?? 'generation',
    fileCount: Object.keys(document.get('files') ?? {}).length,
    createdAt: document.get('createdAt')?.toDate?.().toISOString() ?? new Date(0).toISOString(),
  }))
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
