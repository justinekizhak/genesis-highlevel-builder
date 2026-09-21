import type { GenerationEvent } from '@/types/generation'

export type VariationActivityItem = {
  key: string
  label: string
  state: 'active' | 'complete' | 'failed'
}

export function responseUiCopy(value: string): string {
  return value
    .replace(/\bDirection A\b/g, 'Response 1')
    .replace(/\bDirection B\b/g, 'Response 2')
    .replace(/\bdirections\b/gi, 'responses')
    .replace(/\bdirection\b/gi, 'response')
}

const candidatePhaseCopy = {
  summary: 'is planning the layout',
  markup: 'is writing the interface',
  styles: 'is styling the interface',
  logic: 'is wiring the interactions',
} as const

export function variationActivityForEvent(
  event: GenerationEvent,
  candidateNumber?: number,
): VariationActivityItem | undefined {
  const response = candidateNumber ? `Response ${candidateNumber}` : undefined

  switch (event.type) {
    case 'variation_planning_started':
      return { key: 'planning', label: 'Understanding your request', state: 'active' }
    case 'variation_set_started':
      return { key: 'briefs', label: 'Four response briefs are ready', state: 'complete' }
    case 'candidate_started':
      return { key: `response-${event.index + 1}`, label: `Response ${event.index + 1} is generating code`, state: 'active' }
    case 'candidate_progress':
      if (!response) return undefined
      return { key: `response-${candidateNumber}`, label: `${response} ${candidatePhaseCopy[event.phase]}`, state: 'active' }
    case 'candidate_complete':
      if (!response) return undefined
      return { key: `response-${candidateNumber}`, label: `${response} finished generating`, state: 'complete' }
    case 'candidate_failed':
      if (!response) return undefined
      return { key: `response-${candidateNumber}`, label: `${response} could not be completed`, state: 'failed' }
    case 'variation_validation_started':
      return { key: 'validation', label: 'Checking all generated responses', state: 'active' }
    case 'variation_validation_complete':
      return { key: 'validation', label: `${event.eligibleCount} responses passed the checks`, state: 'complete' }
    case 'variation_grading_started':
      return { key: 'comparison', label: 'Comparing the strongest responses', state: 'active' }
    case 'variation_grading_progress':
      return {
        key: 'comparison',
        label: `Comparing the strongest responses (${event.completedCount} of ${event.totalCount} scored)`,
        state: 'active',
      }
    case 'variation_grading_complete':
      return { key: 'comparison', label: 'The strongest responses have been selected', state: 'complete' }
    case 'finalist_metadata':
      return { key: 'previews', label: 'Loading the two final previews', state: 'active' }
    case 'finalists_ready':
    case 'variation_complete':
      return { key: 'ready', label: 'Two responses are ready to compare', state: 'complete' }
    default:
      return undefined
  }
}
