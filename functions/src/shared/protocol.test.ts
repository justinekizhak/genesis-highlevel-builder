import { describe, expect, it } from 'vitest'
import { isTerminalEvent, isVariationEvent, serializeSse, type GenerationEvent } from './protocol.js'

describe('serializeSse', () => {
  it('formats an SSE frame with an event name and a JSON data line', () => {
    const frame = serializeSse({ type: 'complete', generationId: 'gen-1' })
    expect(frame).toBe('event: complete\ndata: {"type":"complete","generationId":"gen-1"}\n\n')
  })

  it('round-trips through JSON.parse for every event shape', () => {
    const events = [
      { type: 'generation_started' as const, generationId: 'g1' },
      { type: 'token' as const, delta: 'hi' },
      { type: 'file_start' as const, path: 'app.js', language: 'javascript' },
      { type: 'file_delta' as const, path: 'app.js', delta: 'console.log(1)' },
      { type: 'file_complete' as const, path: 'app.js', size: 10, sha256: 'abc' },
      { type: 'snapshot_created' as const, snapshotId: 's1' },
      { type: 'complete' as const, generationId: 'g1' },
      { type: 'error' as const, code: 'X', message: 'bad', recoverable: true },
    ]
    for (const event of events) {
      const frame = serializeSse(event)
      const [eventLine, dataLine] = frame.trimEnd().split('\n')
      expect(eventLine).toBe(`event: ${event.type}`)
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual(event)
    }
  })
})

describe('variation events', () => {
  it('serializes candidate-aware events', () => {
    const event: GenerationEvent = {
      type: 'candidate_progress',
      candidateId: 'opaque-a',
      phase: 'styles',
    }
    expect(serializeSse(event)).toContain('event: candidate_progress')

    const complete: GenerationEvent = { type: 'variation_complete', variationSetId: 'set-1' }
    expect(serializeSse(complete)).toContain('variation_complete')
  })

  it('round-trips every variation event shape', () => {
    const events: GenerationEvent[] = [
      { type: 'variation_planning_started' },
      { type: 'variation_set_started', variationSetId: 'set-1', count: 4 },
      { type: 'candidate_started', candidateId: 'opaque-a', index: 0 },
      { type: 'candidate_progress', candidateId: 'opaque-a', phase: 'markup' },
      { type: 'candidate_complete', candidateId: 'opaque-a' },
      { type: 'candidate_failed', candidateId: 'opaque-b', recoverable: true },
      { type: 'variation_validation_started', completedCount: 3 },
      { type: 'variation_validation_complete', eligibleCount: 3 },
      { type: 'variation_grading_started', eligibleCount: 3 },
      { type: 'variation_grading_complete', gradingMode: 'full' },
      {
        type: 'finalist_metadata',
        variationSetId: 'set-1',
        finalists: [{ candidateId: 'opaque-a', displayName: 'Direction A', summary: 'A', standout: 'Stands out.' }],
      },
      { type: 'finalist_file_start', candidateId: 'opaque-a', path: 'styles.css', language: 'css' },
      { type: 'finalist_file_delta', candidateId: 'opaque-a', path: 'styles.css', delta: 'body{}' },
      { type: 'finalist_file_complete', candidateId: 'opaque-a', path: 'styles.css', size: 6, sha256: 'abc' },
      { type: 'finalists_ready', variationSetId: 'set-1' },
      { type: 'variation_complete', variationSetId: 'set-1' },
    ]
    for (const event of events) {
      const [eventLine, dataLine] = serializeSse(event).trimEnd().split('\n')
      expect(eventLine).toBe(`event: ${event.type}`)
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual(event)
    }
  })

  it('separates variation events from single-generation events', () => {
    expect(isVariationEvent({ type: 'variation_set_started', variationSetId: 's', count: 4 })).toBe(true)
    expect(isVariationEvent({ type: 'finalist_file_delta', candidateId: 'a', path: 'app.js', delta: 'x' })).toBe(true)
    expect(isVariationEvent({ type: 'file_delta', path: 'app.js', delta: 'x' })).toBe(false)
    expect(isVariationEvent({ type: 'complete', generationId: 'g1' })).toBe(false)
  })

  it('treats variation_complete as a terminal event alongside complete and error', () => {
    expect(isTerminalEvent({ type: 'variation_complete', variationSetId: 'set-1' })).toBe(true)
    expect(isTerminalEvent({ type: 'complete', generationId: 'g1' })).toBe(true)
    expect(isTerminalEvent({ type: 'error', code: 'X', message: 'bad', recoverable: true })).toBe(true)
    expect(isTerminalEvent({ type: 'finalists_ready', variationSetId: 'set-1' })).toBe(false)
  })
})
