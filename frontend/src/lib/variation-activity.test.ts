import { describe, expect, it } from 'vitest'
import { variationActivityForEvent } from './variation-activity'

describe('variationActivityForEvent', () => {
  it('turns truthful SSE milestones into customer-facing response activity', () => {
    expect(variationActivityForEvent({ type: 'variation_set_started', variationSetId: 'set-1', count: 4 }))
      .toEqual({ key: 'briefs', label: 'Four response briefs are ready', state: 'complete' })
    expect(variationActivityForEvent({ type: 'candidate_progress', candidateId: 'opaque-b', phase: 'styles' }, 2))
      .toEqual({ key: 'response-2', label: 'Response 2 is styling the interface', state: 'active' })
    expect(variationActivityForEvent({ type: 'variation_validation_started', completedCount: 4 }))
      .toEqual({ key: 'validation', label: 'Checking all generated responses', state: 'active' })
    expect(variationActivityForEvent({ type: 'finalists_ready', variationSetId: 'set-1' }))
      .toEqual({ key: 'ready', label: 'Two responses are ready to compare', state: 'complete' })
  })

  it('does not expose opaque candidate identifiers or fabricate activity for file chunks', () => {
    expect(variationActivityForEvent({ type: 'candidate_started', candidateId: 'secret-id', index: 0 }))
      .toEqual({ key: 'response-1', label: 'Response 1 is generating code', state: 'active' })
    expect(variationActivityForEvent({ type: 'finalist_file_delta', candidateId: 'secret-id', path: 'app.js', delta: 'x' }))
      .toBeUndefined()
    expect(variationActivityForEvent({ type: 'candidate_failed', candidateId: 'secret-id', recoverable: true }, 1))
      .toEqual({ key: 'response-1', label: 'Response 1 could not be completed', state: 'failed' })
  })
})
