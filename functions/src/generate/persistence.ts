import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import type { GeneratedApplication } from './application.js'

export async function requireOwnedProject(uid: string, projectId: string) {
  const reference = getFirestore().collection('projects').doc(projectId)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.get('ownerId') !== uid || snapshot.get('deletedAt')) {
    throw new Error('Project was not found.')
  }
  return reference
}

export async function persistGeneration(input: {
  uid: string
  projectId: string
  prompt: string
  application: GeneratedApplication
  generationId: string
  snapshotId: string
  provider: 'openai' | 'mock'
}) {
  const projectReference = await requireOwnedProject(input.uid, input.projectId)
  const db = getFirestore()
  const batch = db.batch()
  const messages = projectReference.collection('messages')
  const snapshotReference = projectReference.collection('snapshots').doc(input.snapshotId)
  const now = Timestamp.now()
  const assistantTime = Timestamp.fromMillis(now.toMillis() + 1)

  batch.set(messages.doc(), { role: 'user', content: input.prompt, generationId: input.generationId, createdAt: now })
  batch.set(messages.doc(), { role: 'assistant', content: input.application.summary, generationId: input.generationId, createdAt: assistantTime })
  batch.set(snapshotReference, {
    generationId: input.generationId,
    prompt: input.prompt,
    summary: input.application.summary,
    files: Object.fromEntries(input.application.files.map((file) => [file.path, file.content])),
    provider: input.provider,
    createdAt: now,
  })
  batch.update(projectReference, { latestSnapshotId: input.snapshotId, updatedAt: FieldValue.serverTimestamp() })
  await batch.commit()
}

export async function loadProjectState(uid: string, projectId: string) {
  const projectReference = await requireOwnedProject(uid, projectId)
  const [project, messages] = await Promise.all([
    projectReference.get(),
    projectReference.collection('messages').orderBy('createdAt', 'asc').limitToLast(80).get(),
  ])
  const snapshotId = project.get('latestSnapshotId') as string | undefined
  const snapshot = snapshotId ? await projectReference.collection('snapshots').doc(snapshotId).get() : undefined
  return {
    snapshotId: snapshot?.id,
    files: snapshot?.get('files') ?? null,
    messages: messages.docs.map((document) => ({
      id: document.id,
      role: document.get('role'),
      content: document.get('content'),
    })),
  }
}
