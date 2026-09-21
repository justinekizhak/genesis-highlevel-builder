import type {
  ChatMessage,
  GeneratedFile,
  GenerationEvent,
  GenerationModel,
  ProjectSnapshot,
  VariationSetPayload,
} from '@/types/generation'
import { requireApiV1BaseUrl, requireStreamingApiV1BaseUrl } from './api'

/** `variation_complete` replaces `complete` for a multi-variant batch, so both end a stream. */
function isTerminalEvent(event: GenerationEvent) {
  return event.type === 'complete' || event.type === 'error' || event.type === 'variation_complete'
}

type GenerateOptions = {
  prompt: string
  projectId: string
  generationId: string
  model: GenerationModel
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
        if (isTerminalEvent(event)) sawTerminal = true
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
      if (isTerminalEvent(event)) sawTerminal = true
    }
  }
  if (!sawTerminal) throw new Error('Generation stream ended before completion. Partial output has been preserved.')
}

// Firebase Hosting buffers the entire response body for rewrites to Cloud Functions/Cloud Run,
// which defeats SSE streaming even though the function itself flushes incrementally. Only the
// streaming generateApp call needs to bypass Hosting and hit the Cloud Function directly; every
// other endpoint here is a normal request/response and can keep going through the /api rewrite.
const generationLockRetryDelays = [150, 250, 400, 650, 1_000, 1_500]

function waitForGenerationLock(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      return
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    const abort = () => {
      window.clearTimeout(timeout)
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function generateApplication(options: GenerateOptions) {
  const baseUrl = requireStreamingApiV1BaseUrl()
  if (!options.idToken) throw new Error('Sign in again before generating.')
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${baseUrl}/projects/${encodeURIComponent(options.projectId)}/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.idToken}` },
      body: JSON.stringify({
        prompt: options.prompt,
        generationId: options.generationId,
        model: options.model,
      }),
      signal: options.signal,
    })
    if (response.status === 409 && attempt < generationLockRetryDelays.length) {
      await waitForGenerationLock(generationLockRetryDelays[attempt]!, options.signal)
      continue
    }
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `Generation request failed (${response.status})`)
    }

    await consumeGenerationStream(response, options.onEvent)
    return
  }
}

export async function cancelApplicationGeneration(projectId: string, generationId: string, idToken?: string) {
  if (!idToken) throw new Error('Sign in again to stop this generation.')
  return authenticatedRequest<{ status: 'cancel_requested' | 'not_running' }>(`projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/cancellation`, idToken, {
    method: 'POST',
    body: '{}',
  })
}

export type ProjectApplicationState = {
  snapshotId?: string
  pendingVariationSetId?: string
  files: Record<string, string> | null
  messages: ChatMessage[]
}

async function authenticatedRequest<T>(path: string, idToken: string, init?: RequestInit): Promise<T> {
  const baseUrl = requireApiV1BaseUrl()
  const response = await fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`)
  return body
}

export async function loadApplicationState(projectId: string, idToken?: string): Promise<ProjectApplicationState | null> {
  if (!idToken) throw new Error('Sign in again to load this project.')
  const baseUrl = requireApiV1BaseUrl()
  const url = new URL(`${baseUrl}/projects/${encodeURIComponent(projectId)}/application`)
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })
  if (!response.ok) throw new Error(`Could not load project state (${response.status})`)
  return response.json() as Promise<ProjectApplicationState>
}

export async function saveApplicationFiles(projectId: string, files: Record<string, GeneratedFile>, idToken?: string) {
  const stateFiles = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]))
  if (!idToken) throw new Error('Sign in again to save files.')
  const result = await authenticatedRequest<{ ok: true; snapshotId?: string }>(`projects/${encodeURIComponent(projectId)}/files`, idToken, {
    method: 'PUT',
    body: JSON.stringify({ files: stateFiles }),
  })
  return { files: stateFiles, snapshotId: result.snapshotId }
}

export async function listApplicationSnapshots(projectId: string, idToken?: string): Promise<ProjectSnapshot[]> {
  if (!idToken) throw new Error('Sign in again to load snapshots.')
  const result = await authenticatedRequest<{ snapshots: ProjectSnapshot[] }>(`projects/${encodeURIComponent(projectId)}/snapshots`, idToken)
  return result.snapshots
}

export async function loadSnapshotFiles(projectId: string, snapshotId: string, idToken?: string): Promise<Record<string, string>> {
  if (!idToken) throw new Error('Sign in again to load this snapshot.')
  const result = await authenticatedRequest<{ files: Record<string, string> }>(`projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/files`, idToken)
  return result.files
}

export async function updateSnapshotField(
  projectId: string,
  snapshotId: string,
  field: 'message' | 'description',
  value: string,
  idToken?: string,
) {
  if (!idToken) throw new Error('Sign in again to edit this snapshot.')
  return authenticatedRequest<{ id: string; field: string; value: string }>(`projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`, idToken, {
    method: 'PATCH',
    body: JSON.stringify({ field, value }),
  })
}

export async function restoreApplicationSnapshot(projectId: string, snapshotId: string, idToken?: string) {
  if (!idToken) throw new Error('Sign in again to restore a snapshot.')
  return authenticatedRequest<{ snapshotId: string; files: Record<string, string>; backupSnapshotId?: string }>(`projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restorations`, idToken, {
    method: 'POST',
    body: '{}',
  })
}

export async function loadVariationSet(
  projectId: string,
  variationSetId: string,
  idToken?: string,
): Promise<VariationSetPayload> {
  if (!idToken) throw new Error('Sign in again to load this comparison.')
  return authenticatedRequest<VariationSetPayload>(
    `projects/${encodeURIComponent(projectId)}/variation-sets/${encodeURIComponent(variationSetId)}`,
    idToken,
  )
}

export async function selectVariationFinalist(
  projectId: string,
  variationSetId: string,
  candidateId: string,
  idToken?: string,
): Promise<{ snapshotId: string; files: Record<string, string> }> {
  if (!idToken) throw new Error('Sign in again to choose a direction.')
  return authenticatedRequest<{ snapshotId: string; files: Record<string, string> }>(
    `projects/${encodeURIComponent(projectId)}/variation-sets/${encodeURIComponent(variationSetId)}/selection`,
    idToken,
    { method: 'POST', body: JSON.stringify({ candidateId }) },
  )
}
