export type GeneratedFile = {
  path: string
  content: string
  language: string
}

export const generationModels = [
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano' },
] as const

export type GenerationModel = (typeof generationModels)[number]['value']

export function isGenerationModel(value: string): value is GenerationModel {
  return generationModels.some((model) => model.value === value)
}

export type CandidatePhase = 'summary' | 'markup' | 'styles' | 'logic'

export type VariationDisplayName = 'Direction A' | 'Direction B'

export type VariationBrief = {
  id: string
  title: string
  designIntent: string
  informationArchitecture: string
  interactionModel: string
  visualDirection: string
  density: 'compact' | 'balanced' | 'spacious'
  differentiators: string[]
}

export type VariationRubric = {
  featureFidelity: number
  functionalCorrectness: number
  robustness: number
  usability: number
  accessibility: number
  responsiveness: number
  maintainability: number
  standout: string
  evidence: Array<{ path: 'index.html' | 'styles.css' | 'app.js'; detail: string }>
}

export type FinalistMetadata = {
  candidateId: string
  displayName: VariationDisplayName
  summary: string
  standout: string
  /** Rank among the graded finalists (1 = highest-scoring). Absent only on deterministic fallback. */
  internalRank?: number
  scoreBreakdown?: Record<string, number>
  brief?: VariationBrief
  /** Absent only when grading fell back to the deterministic ranking (no rubric model call was made). */
  rubric?: VariationRubric
}

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
  | { type: 'finalist_file_complete'; candidateId: string; path: string; size: number; sha256?: string }
  | { type: 'finalists_ready'; variationSetId: string }
  | { type: 'variation_complete'; variationSetId: string }

export type GenerationEvent =
  | VariationGenerationEvent
  | { type: 'generation_started'; generationId: string; provider?: 'openai'; model?: string }
  | { type: 'token'; delta: string }
  | { type: 'file_start'; path: string; language: string }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_complete'; path: string; size: number; sha256?: string }
  | { type: 'snapshot_created'; snapshotId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: 'complete'; generationId: string }
  | { type: 'error'; code: string; message: string; recoverable: boolean }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export type ProjectSnapshot = {
  id: string
  generationId?: string
  prompt: string
  summary: string
  label?: string
  provider: string
  model?: string
  kind?: 'generation' | 'partial' | 'backup' | 'manual'
  /** Present only on a snapshot promoted from a variation finalist. */
  variationSetId?: string
  variationCandidateId?: string
  fileCount: number
  createdAt: string
}

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

export type VariationFinalist = FinalistMetadata & {
  files: Record<string, GeneratedFile>
}

export type VariationSetPayload = {
  variationSetId: string
  status: 'ready' | 'selected' | 'failed' | 'cancelled'
  gradingMode: 'full' | 'deterministic_fallback'
  prompt: string
  baseSnapshotId?: string
  initialSelectedCandidateId?: string
  activeCandidateId?: string
  requestedCount: number
  eligibleCount: number
  finalists: Array<FinalistMetadata & { files: Record<string, string> }>
}

export type VariationPhase = 'planning' | 'generating' | 'validating' | 'grading' | 'preparing'

export type CandidateProgress = {
  candidateId: string
  index: number
  phase: 'started' | CandidatePhase | 'complete' | 'failed'
}

export type WorkspaceGenerationState =
  | { mode: 'idle' }
  | { mode: 'single'; generationId: string }
  | {
      mode: 'variations-running'
      generationId: string
      variationSetId?: string
      phase: VariationPhase
      gradingMode?: 'full' | 'deterministic_fallback'
      gradingProgress?: { completedCount: number; totalCount: number }
      eligibleCount?: number
      requestedCount?: number
      candidates: Record<string, CandidateProgress>
      finalists: Record<string, VariationFinalist>
    }
  | {
      mode: 'variations-ready'
      variationSetId: string
      gradingMode?: 'full' | 'deterministic_fallback'
      eligibleCount?: number
      requestedCount?: number
      finalists: [VariationFinalist, VariationFinalist]
    }
  | {
      mode: 'variation-selecting'
      variationSetId: string
      candidateId: string
      gradingMode?: 'full' | 'deterministic_fallback'
      eligibleCount?: number
      requestedCount?: number
      finalists: [VariationFinalist, VariationFinalist]
    }
