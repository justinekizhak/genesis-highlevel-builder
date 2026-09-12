import type { ChatMessage, GeneratedFile, GenerationEvent, ProjectSnapshot } from '@/types/generation'

type GenerateOptions = {
  prompt: string
  projectId: string
  currentFiles: Record<string, GeneratedFile>
  idToken?: string
  signal: AbortSignal
  onEvent: (event: GenerationEvent) => void
}

export function parseSseBlock(block: string): GenerationEvent | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return
  return JSON.parse(data) as GenerationEvent
}

export async function consumeGenerationStream(response: Response, onEvent: (event: GenerationEvent) => void) {
  if (!response.body) throw new Error('Generation response contained no stream.')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let sawTerminal = false
  while (true) {
    const { done, value = '' } = await reader.read()
    buffer += value.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const event = parseSseBlock(buffer.slice(0, boundary))
      if (event) {
        onEvent(event)
        if (event.type === 'complete' || event.type === 'error') sawTerminal = true
      }
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) {
    const event = parseSseBlock(buffer)
    if (event) {
      onEvent(event)
      if (event.type === 'complete' || event.type === 'error') sawTerminal = true
    }
  }
  if (!sawTerminal) throw new Error('Generation stream ended before completion. Partial output has been preserved.')
}

function requireFunctionsBaseUrl() {
  const baseUrl = import.meta.env.VITE_FUNCTIONS_BASE_URL?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('Firebase Functions are not configured. Set VITE_FUNCTIONS_BASE_URL.')
  return baseUrl
}

// Firebase Hosting buffers the entire response body for rewrites to Cloud Functions/Cloud Run,
// which defeats SSE streaming even though the function itself flushes incrementally. Only the
// streaming generateApp call needs to bypass Hosting and hit the Cloud Function directly; every
// other endpoint here is a normal request/response and can keep going through the /api rewrite.
function requireStreamingFunctionsBaseUrl() {
  const override = import.meta.env.VITE_FUNCTIONS_STREAM_BASE_URL?.replace(/\/$/, '')
  if (override) return override
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') return requireFunctionsBaseUrl()
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (!projectId) return requireFunctionsBaseUrl()
  return `https://us-central1-${projectId}.cloudfunctions.net`
}

export async function generateApplication(options: GenerateOptions) {
  const baseUrl = requireStreamingFunctionsBaseUrl()
  if (!options.idToken) throw new Error('Sign in again before generating.')
  const response = await fetch(`${baseUrl}/generateApp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.idToken}` },
    body: JSON.stringify({
      prompt: options.prompt,
      projectId: options.projectId,
    }),
    signal: options.signal,
  })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Generation request failed (${response.status})`)
  }

  await consumeGenerationStream(response, options.onEvent)
}

export type ProjectApplicationState = {
  snapshotId?: string
  files: Record<string, string> | null
  messages: ChatMessage[]
}

async function authenticatedRequest<T>(path: string, idToken: string, init?: RequestInit): Promise<T> {
  const baseUrl = requireFunctionsBaseUrl()
  const response = await fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`)
  return body
}

export async function loadApplicationState(projectId: string, idToken?: string): Promise<ProjectApplicationState | null> {
  requireFunctionsBaseUrl()
  if (!idToken) throw new Error('Sign in again to load this project.')
  const baseUrl = requireFunctionsBaseUrl()
  const url = new URL(`${baseUrl}/projectState`)
  url.searchParams.set('projectId', projectId)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!response.ok) throw new Error(`Could not load project state (${response.status})`)
  return response.json() as Promise<ProjectApplicationState>
}

export async function saveApplicationFiles(projectId: string, files: Record<string, GeneratedFile>, idToken?: string) {
  const stateFiles = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]))
  if (!idToken) throw new Error('Sign in again to save files.')
  const result = await authenticatedRequest<{ ok: true; snapshotId?: string }>('saveFiles', idToken, {
    method: 'POST',
    body: JSON.stringify({ projectId, files: stateFiles }),
  })
  return { files: stateFiles, snapshotId: result.snapshotId }
}

export async function listApplicationSnapshots(projectId: string, idToken?: string): Promise<ProjectSnapshot[]> {
  if (!idToken) throw new Error('Sign in again to load snapshots.')
  const query = new URLSearchParams({ projectId })
  const result = await authenticatedRequest<{ snapshots: ProjectSnapshot[] }>(`projectSnapshots?${query}`, idToken)
  return result.snapshots
}

export async function loadSnapshotFiles(projectId: string, snapshotId: string, idToken?: string): Promise<Record<string, string>> {
  if (!idToken) throw new Error('Sign in again to load this snapshot.')
  const query = new URLSearchParams({ projectId, snapshotId })
  const result = await authenticatedRequest<{ files: Record<string, string> }>(`projectSnapshotFiles?${query}`, idToken)
  return result.files
}

export async function restoreApplicationSnapshot(projectId: string, snapshotId: string, idToken?: string) {
  if (!idToken) throw new Error('Sign in again to restore a snapshot.')
  return authenticatedRequest<{ snapshotId: string; files: Record<string, string>; backupSnapshotId?: string }>('restoreSnapshot', idToken, {
    method: 'POST',
    body: JSON.stringify({ projectId, snapshotId }),
  })
}
