import { describe, expect, it } from 'vitest'
import {
  finalistFilesFor,
  idleVariationState,
  initialVariationState,
  orderFinalists,
  reduceVariationEvent,
  VariationReconstructionError,
} from './variation-state'
import type { GenerationEvent } from '@/types/generation'

function fileEvents(candidateId: string, path: string, content: string, sha256: string): GenerationEvent[] {
  return [
    { type: 'finalist_file_start', candidateId, path, language: path.endsWith('.css') ? 'css' : 'html' },
    { type: 'finalist_file_delta', candidateId, path, delta: content },
    { type: 'finalist_file_complete', candidateId, path, size: content.length, sha256 },
  ]
}

// sha256('body{}') and sha256('.app{}')
const bodyHash = '7c98040a541657584690ae2a1cc3b42a8b53b159cc60c5d3abbfecbaeac6c94a'

const metadata: GenerationEvent = {
  type: 'finalist_metadata',
  variationSetId: 'set-1',
  finalists: [
    { candidateId: 'a', displayName: 'Direction A', summary: 'Compact table', standout: 'Scannable rows at a glance.' },
    { candidateId: 'b', displayName: 'Direction B', summary: 'Split rail', standout: 'Roomy layout with fewer clicks.' },
  ],
}

describe('reduceVariationEvent', () => {
  it('stays idle until a variation set starts', () => {
    let state = idleVariationState()
    state = reduceVariationEvent(state, { type: 'file_delta', path: 'index.html', delta: '<div>' })
    state = reduceVariationEvent(state, { type: 'token', delta: 'hello' })
    expect(state.mode).toBe('idle')
    state = reduceVariationEvent(state, { type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    expect(state.mode).toBe('variations-running')
  })

  it('keeps interleaved candidate progress isolated', () => {
    let state = initialVariationState('generation-1')
    state = reduceVariationEvent(state, { type: 'candidate_started', candidateId: 'a', index: 0 })
    state = reduceVariationEvent(state, { type: 'candidate_started', candidateId: 'b', index: 1 })
    state = reduceVariationEvent(state, { type: 'candidate_progress', candidateId: 'a', phase: 'styles' })
    if (state.mode !== 'variations-running') throw new Error('expected a running state')
    expect(state.candidates.a?.phase).toBe('styles')
    expect(state.candidates.b?.phase).toBe('started')
  })

  it('advances the displayed phase only on real events', () => {
    let state = initialVariationState('generation-1')
    expect(state.mode === 'variations-running' && state.phase).toBe('planning')
    state = reduceVariationEvent(state, { type: 'variation_set_started', variationSetId: 'set-1', count: 4 })
    expect(state.mode === 'variations-running' && state.phase).toBe('generating')
    state = reduceVariationEvent(state, { type: 'variation_validation_started', completedCount: 4 })
    expect(state.mode === 'variations-running' && state.phase).toBe('validating')
    state = reduceVariationEvent(state, { type: 'variation_grading_started', eligibleCount: 4 })
    expect(state.mode === 'variations-running' && state.phase).toBe('grading')
    state = reduceVariationEvent(state, { type: 'finalist_metadata', variationSetId: 'set-1', finalists: [] })
    expect(state.mode === 'variations-running' && state.phase).toBe('preparing')
  })

  it('marks a failed candidate without disturbing its siblings', () => {
    let state = initialVariationState('generation-1')
    state = reduceVariationEvent(state, { type: 'candidate_started', candidateId: 'a', index: 0 })
    state = reduceVariationEvent(state, { type: 'candidate_started', candidateId: 'b', index: 1 })
    state = reduceVariationEvent(state, { type: 'candidate_failed', candidateId: 'b', recoverable: true })
    state = reduceVariationEvent(state, { type: 'candidate_complete', candidateId: 'a' })
    if (state.mode !== 'variations-running') throw new Error('expected a running state')
    expect(state.candidates.b?.phase).toBe('failed')
    expect(state.candidates.a?.phase).toBe('complete')
  })

  it('reconstructs finalist files by candidate id', () => {
    const events: GenerationEvent[] = [
      { type: 'variation_set_started', variationSetId: 'set-1', count: 4 },
      metadata,
      ...fileEvents('a', 'styles.css', 'body{}', bodyHash),
      ...fileEvents('b', 'styles.css', '.app{}', ''),
    ]
    const state = events.reduce(reduceVariationEvent, initialVariationState('generation-1'))
    if (state.mode !== 'variations-running') throw new Error('expected a running state')
    expect(state.finalists.a?.files['styles.css']?.content).toBe('body{}')
    expect(state.finalists.b?.files['styles.css']?.content).toBe('.app{}')
  })

  it('throws a recoverable reconstruction error on a size mismatch', () => {
    let state = initialVariationState('generation-1')
    state = reduceVariationEvent(state, { type: 'finalist_file_start', candidateId: 'a', path: 'app.js', language: 'javascript' })
    state = reduceVariationEvent(state, { type: 'finalist_file_delta', candidateId: 'a', path: 'app.js', delta: 'abc' })
    expect(() => reduceVariationEvent(state, {
      type: 'finalist_file_complete', candidateId: 'a', path: 'app.js', size: 99, sha256: '',
    })).toThrow(VariationReconstructionError)
  })

  it('throws a recoverable reconstruction error on a hash mismatch', () => {
    let state = initialVariationState('generation-1')
    state = reduceVariationEvent(state, { type: 'finalist_file_start', candidateId: 'a', path: 'styles.css', language: 'css' })
    state = reduceVariationEvent(state, { type: 'finalist_file_delta', candidateId: 'a', path: 'styles.css', delta: 'body{}' })
    expect(() => reduceVariationEvent(state, {
      type: 'finalist_file_complete', candidateId: 'a', path: 'styles.css', size: 6, sha256: 'f'.repeat(64),
    })).toThrow(VariationReconstructionError)
  })

  it('accepts a matching hash', () => {
    let state = initialVariationState('generation-1')
    state = reduceVariationEvent(state, { type: 'finalist_file_start', candidateId: 'a', path: 'styles.css', language: 'css' })
    state = reduceVariationEvent(state, { type: 'finalist_file_delta', candidateId: 'a', path: 'styles.css', delta: 'body{}' })
    expect(() => reduceVariationEvent(state, {
      type: 'finalist_file_complete', candidateId: 'a', path: 'styles.css', size: 6, sha256: bodyHash,
    })).not.toThrow()
  })

  it('becomes ready with exactly two finalists in a stable display order', () => {
    const events: GenerationEvent[] = [
      { type: 'variation_set_started', variationSetId: 'set-1', count: 4 },
      metadata,
      ...fileEvents('b', 'styles.css', '.app{}', ''),
      ...fileEvents('a', 'styles.css', 'body{}', bodyHash),
      { type: 'finalists_ready', variationSetId: 'set-1' },
      { type: 'variation_complete', variationSetId: 'set-1' },
    ]
    const state = events.reduce(reduceVariationEvent, initialVariationState('generation-1'))
    if (state.mode !== 'variations-ready') throw new Error('expected a ready state')
    expect(state.finalists).toHaveLength(2)
    expect(state.finalists.map((finalist) => finalist.displayName)).toEqual(['Direction A', 'Direction B'])
    expect(state.finalists[0].candidateId).toBe('a')
    expect(finalistFilesFor(state.finalists[0])['styles.css']).toBe('body{}')
  })

  it('orders finalists by display name regardless of arrival order', () => {
    const ordered = orderFinalists([
      { candidateId: 'b', displayName: 'Direction B', summary: '', standout: '', files: {} },
      { candidateId: 'a', displayName: 'Direction A', summary: '', standout: '', files: {} },
    ])
    expect(ordered.map((finalist) => finalist.candidateId)).toEqual(['a', 'b'])
  })
})
