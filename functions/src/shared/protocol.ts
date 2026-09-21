export type CandidatePhase = 'summary' | 'markup' | 'styles' | 'logic'

export type VariationDisplayName = 'Direction A' | 'Direction B'

export type FinalistMetadata = {
  candidateId: string
  displayName: VariationDisplayName
  summary: string
  standout: string
}

/**
 * Variant-aware events. Candidate code is never streamed while candidates are being generated;
 * only coarse, event-backed phase changes reach the client until two finalists are persisted.
 */
export type VariationGenerationEvent =
  | { type: 'variation_planning_started' }
  | { type: 'variation_set_started'; variationSetId: string; count: 4 }
  | { type: 'candidate_started'; candidateId: string; index: number }
  | { type: 'candidate_progress'; candidateId: string; phase: CandidatePhase }
  | { type: 'candidate_complete'; candidateId: string }
  | { type: 'candidate_failed'; candidateId: string; recoverable: boolean }
  | { type: 'variation_validation_started'; completedCount: number }
  | { type: 'variation_validation_complete'; eligibleCount: number }
  | { type: 'variation_grading_started'; eligibleCount: number }
  | { type: 'variation_grading_progress'; completedCount: number; totalCount: number }
  | { type: 'variation_grading_complete'; gradingMode: 'full' | 'deterministic_fallback' }
  | { type: 'finalist_metadata'; variationSetId: string; finalists: FinalistMetadata[] }
  | { type: 'finalist_file_start'; candidateId: string; path: string; language: string }
  | { type: 'finalist_file_delta'; candidateId: string; path: string; delta: string }
  | { type: 'finalist_file_complete'; candidateId: string; path: string; size: number; sha256: string }
  | { type: 'finalists_ready'; variationSetId: string }
  | { type: 'variation_complete'; variationSetId: string }

export type SingleGenerationEvent =
  | { type: 'generation_started'; generationId: string; provider?: 'openai'; model?: string }
  | { type: 'token'; delta: string }
  | { type: 'file_start'; path: string; language: string }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_complete'; path: string; size: number; sha256: string }
  | { type: 'snapshot_created'; snapshotId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'complete'; generationId: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export type GenerationEvent = SingleGenerationEvent | VariationGenerationEvent

const variationEventTypes = new Set<GenerationEvent['type']>([
  'variation_planning_started',
  'variation_set_started',
  'candidate_started',
  'candidate_progress',
  'candidate_complete',
  'candidate_failed',
  'variation_validation_started',
  'variation_validation_complete',
  'variation_grading_started',
  'variation_grading_progress',
  'variation_grading_complete',
  'finalist_metadata',
  'finalist_file_start',
  'finalist_file_delta',
  'finalist_file_complete',
  'finalists_ready',
  'variation_complete',
])

export function isVariationEvent(event: GenerationEvent): event is VariationGenerationEvent {
  return variationEventTypes.has(event.type)
}

/** Terminal events end a stream; `variation_complete` replaces `complete` for a variation batch. */
export function isTerminalEvent(event: GenerationEvent) {
  return event.type === 'complete' || event.type === 'error' || event.type === 'variation_complete'
}

export function serializeSse(event: GenerationEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}
