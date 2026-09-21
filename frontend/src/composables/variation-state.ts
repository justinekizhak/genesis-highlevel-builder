import type {
  GeneratedFile,
  GenerationEvent,
  VariationFinalist,
  VariationPhase,
  WorkspaceGenerationState,
} from '@/types/generation'

export class VariationReconstructionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VariationReconstructionError'
  }
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/**
 * The reducer is synchronous and pure, so it cannot await `crypto.subtle`. This compact SHA-256
 * lets a finalist file be verified at the moment its last chunk arrives, which is the only point
 * where a truncated transfer is still cheap to reject.
 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 9) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(bytes)
  buffer[bytes.length] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false)

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const words = new Uint32Array(64)
  const rotate = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift))

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15]!
      const b = words[index - 2]!
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choice + K[index]! + words[index]!) >>> 0
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index]! + next[index]!) >>> 0
  }

  return hash.map((value) => value.toString(16).padStart(8, '0')).join('')
}

export function idleVariationState(): WorkspaceGenerationState {
  return { mode: 'idle' }
}

export function initialVariationState(generationId: string): WorkspaceGenerationState {
  return { mode: 'variations-running', generationId, phase: 'planning', candidates: {}, finalists: {} }
}

export function orderFinalists(finalists: VariationFinalist[]): VariationFinalist[] {
  // Display position is decided server-side and carried by displayName, so left/right stays stable
  // across reloads and never tracks internal rank or arrival order.
  return [...finalists].sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export function finalistFilesFor(finalist: VariationFinalist): Record<string, string> {
  return Object.fromEntries(Object.entries(finalist.files).map(([path, file]) => [path, file.content]))
}

function languageFor(path: string) {
  return path.endsWith('.js') ? 'javascript' : path.endsWith('.css') ? 'css' : 'html'
}

function withFinalist(
  finalists: Record<string, VariationFinalist>,
  candidateId: string,
  update: (finalist: VariationFinalist) => VariationFinalist,
): Record<string, VariationFinalist> {
  const existing = finalists[candidateId] ?? {
    candidateId,
    displayName: 'Direction A' as const,
    summary: '',
    standout: '',
    files: {} as Record<string, GeneratedFile>,
  }
  return { ...finalists, [candidateId]: update(existing) }
}

function toReadyState(
  variationSetId: string,
  finalists: Record<string, VariationFinalist>,
): WorkspaceGenerationState {
  const ordered = orderFinalists(Object.values(finalists))
  if (ordered.length !== 2) {
    throw new VariationReconstructionError('The comparison arrived incomplete. Reload the project to restore both responses.')
  }
  return { mode: 'variations-ready', variationSetId, finalists: [ordered[0]!, ordered[1]!] }
}

const phaseForEvent: Partial<Record<GenerationEvent['type'], VariationPhase>> = {
  variation_planning_started: 'planning',
  variation_set_started: 'generating',
  variation_validation_started: 'validating',
  variation_grading_started: 'grading',
  finalist_metadata: 'preparing',
}

/**
 * Pure reduction of the variation protocol. Single-generation events are ignored entirely, so the
 * existing editor path keeps ownership of them, and no active workspace file is ever touched here.
 */
export function reduceVariationEvent(
  state: WorkspaceGenerationState,
  event: GenerationEvent,
): WorkspaceGenerationState {
  if (state.mode === 'idle' || state.mode === 'single') {
    if (event.type !== 'variation_set_started') return state
    return {
      mode: 'variations-running',
      generationId: state.mode === 'single' ? state.generationId : event.variationSetId,
      variationSetId: event.variationSetId,
      phase: 'generating',
      candidates: {},
      finalists: {},
    }
  }

  if (state.mode !== 'variations-running') return state

  const phase = phaseForEvent[event.type]
  const next = phase ? { ...state, phase } : { ...state }

  switch (event.type) {
    case 'variation_set_started':
      return { ...next, variationSetId: event.variationSetId }
    case 'candidate_started':
      return {
        ...next,
        candidates: { ...next.candidates, [event.candidateId]: { candidateId: event.candidateId, index: event.index, phase: 'started' } },
      }
    case 'candidate_progress':
    case 'candidate_complete':
    case 'candidate_failed': {
      const existing = next.candidates[event.candidateId]
      if (!existing) return next
      const candidatePhase = event.type === 'candidate_progress'
        ? event.phase
        : event.type === 'candidate_complete' ? 'complete' : 'failed'
      return { ...next, candidates: { ...next.candidates, [event.candidateId]: { ...existing, phase: candidatePhase } } }
    }
    case 'variation_grading_progress':
      return { ...next, gradingProgress: { completedCount: event.completedCount, totalCount: event.totalCount } }
    case 'variation_grading_complete':
      return { ...next, gradingMode: event.gradingMode }
    case 'finalist_metadata': {
      let finalists = next.finalists
      for (const entry of event.finalists) {
        finalists = withFinalist(finalists, entry.candidateId, (finalist) => ({
          ...finalist,
          displayName: entry.displayName,
          summary: entry.summary,
          standout: entry.standout,
        }))
      }
      return { ...next, variationSetId: event.variationSetId, finalists }
    }
    case 'finalist_file_start':
      return {
        ...next,
        finalists: withFinalist(next.finalists, event.candidateId, (finalist) => ({
          ...finalist,
          files: { ...finalist.files, [event.path]: { path: event.path, language: event.language || languageFor(event.path), content: '' } },
        })),
      }
    case 'finalist_file_delta':
      return {
        ...next,
        finalists: withFinalist(next.finalists, event.candidateId, (finalist) => {
          const file = finalist.files[event.path] ?? { path: event.path, language: languageFor(event.path), content: '' }
          return { ...finalist, files: { ...finalist.files, [event.path]: { ...file, content: file.content + event.delta } } }
        }),
      }
    case 'finalist_file_complete': {
      const content = next.finalists[event.candidateId]?.files[event.path]?.content ?? ''
      if (content.length !== event.size) {
        throw new VariationReconstructionError(`The transfer for ${event.path} ended unexpectedly. Reload the comparison to try again.`)
      }
      if (event.sha256 && sha256Hex(content) !== event.sha256) {
        throw new VariationReconstructionError(`The transfer for ${event.path} did not match its checksum. Reload the comparison to try again.`)
      }
      return next
    }
    case 'finalists_ready':
    case 'variation_complete':
      return toReadyState(event.variationSetId ?? next.variationSetId ?? '', next.finalists)
    default:
      return next
  }
}

/** Rebuilds comparison state from a persisted variation set, bypassing the event stream entirely. */
export function variationStateFromPayload(payload: {
  variationSetId: string
  finalists: Array<{ candidateId: string; displayName: 'Direction A' | 'Direction B'; summary: string; standout: string; files: Record<string, string> }>
}): WorkspaceGenerationState {
  const finalists = orderFinalists(payload.finalists.map((entry) => ({
    candidateId: entry.candidateId,
    displayName: entry.displayName,
    summary: entry.summary,
    standout: entry.standout,
    files: Object.fromEntries(Object.entries(entry.files).map(([path, content]) => [path, {
      path,
      content,
      language: languageFor(path),
    }])),
  })))
  if (finalists.length !== 2) {
    throw new VariationReconstructionError('That comparison is incomplete and can no longer be restored.')
  }
  return { mode: 'variations-ready', variationSetId: payload.variationSetId, finalists: [finalists[0]!, finalists[1]!] }
}
