import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeneratedApplication } from './application.js'
import type { GenerationEvent } from '../shared/protocol.js'
import {
  InsufficientVariationCandidatesError,
  mapWithConcurrency,
  runVariationGeneration,
  type VariationRunInput,
} from './variation-orchestrator.js'
import type { GenerationPlan, VariationBrief } from './variation-types.js'

const { gradeCandidate } = vi.hoisted(() => ({ gradeCandidate: vi.fn() }))

vi.mock('./variation-grader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variation-grader.js')>()
  return { ...actual, gradeCandidate }
})

const vueTag = '<script src="https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js"></script>'

function validCandidate(marker = 'x'): GeneratedApplication {
  return {
    summary: `Built a contact dashboard (${marker}).`,
    files: [
      { path: 'index.html', content: `${vueTag}\n<div id="app" v-cloak aria-label="Contact search"></div>` },
      { path: 'styles.css', content: ':root { color-scheme: dark; }\n@media (max-width: 600px) { body { padding: 8px; } }' },
      { path: 'app.js', content: `const loading = true, error = null, empty = [];\nwindow.genesis.highlevel.contacts.list({}); // ${marker}` },
    ],
  }
}

function brief(id: string): VariationBrief {
  return {
    id,
    title: `Direction ${id}`,
    designIntent: `Design intent ${id}`,
    informationArchitecture: `IA ${id}`,
    interactionModel: `Interaction ${id}`,
    visualDirection: `Visual ${id}`,
    density: 'balanced',
    differentiators: [`one-${id}`, `two-${id}`, `three-${id}`],
  }
}

const plan: GenerationPlan = {
  mode: 'variations',
  confidence: 0.95,
  featureContract: { requiredFeatures: ['Contact search'], optionalFeatures: [], invariants: [] },
  variants: [brief('a'), brief('b'), brief('c'), brief('d')],
}

const generateCandidate = vi.fn()
let events: GenerationEvent[]

function input(overrides: Partial<VariationRunInput> = {}): VariationRunInput {
  return {
    prompt: 'Show me a few directions for a contact dashboard',
    plan,
    currentFiles: {},
    model: 'gpt-5.4-mini',
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    generateCandidate,
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

beforeEach(() => {
  events = []
  generateCandidate.mockReset()
  generateCandidate.mockImplementation(async ({ index }: { index: number }) => ({
    application: validCandidate(`variant-${index}`),
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  }))
  gradeCandidate.mockReset()
  gradeCandidate.mockImplementation(async (candidate: { candidateId: string; candidateIndex: number }) => ({
    candidateId: candidate.candidateId,
    graded: true,
    score: {
      alias: `alias-${candidate.candidateIndex}`,
      rubric: {
        alias: `alias-${candidate.candidateIndex}`,
        featureFidelity: 30 - candidate.candidateIndex,
        functionalCorrectness: 20,
        robustness: 12,
        usability: 8,
        accessibility: 8,
        responsiveness: 4,
        maintainability: 4,
        standout: 'Keeps the contact list visible while editing a record.',
        evidence: [],
      },
      deterministicScore: 80,
    },
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mapWithConcurrency', () => {
  it('returns settled results in input order', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, new AbortController().signal, async (value) => {
      if (value === 2) throw new Error('nope')
      return value * 10
    })
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(results[0]).toMatchObject({ value: 10 })
    expect(results[2]).toMatchObject({ value: 30 })
  })

  it('stops pulling new work once the signal aborts', async () => {
    const controller = new AbortController()
    const seen: number[] = []
    await expect(mapWithConcurrency([1, 2, 3, 4], 1, controller.signal, async (value) => {
      seen.push(value)
      controller.abort(new Error('cancelled'))
      return value
    })).rejects.toThrow()
    expect(seen).toEqual([1])
  })
})

describe('runVariationGeneration', () => {
  it('runs all four candidate generations at once', async () => {
    let active = 0
    let peak = 0
    const gates = [deferred(), deferred(), deferred(), deferred()]
    let taken = 0
    generateCandidate.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await gates[taken++]!.promise
      active -= 1
      return { application: validCandidate(), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    })

    const pending = runVariationGeneration(input())
    await Promise.resolve()
    await Promise.resolve()
    expect(active).toBe(4)
    for (const gate of gates) gate.resolve()
    await pending
    expect(peak).toBe(4)
    expect(generateCandidate).toHaveBeenCalledTimes(4)
  })

  it('generates exactly four candidates and persists only two finalists', async () => {
    const result = await runVariationGeneration(input())
    expect(generateCandidate).toHaveBeenCalledTimes(4)
    expect(result.finalists).toHaveLength(2)
    expect(result.finalists.map((finalist) => finalist.internalRank)).toEqual([1, 2])
    expect(new Set(result.finalists.map((finalist) => finalist.displayName))).toEqual(new Set(['Direction A', 'Direction B']))
  })

  it('gives every candidate the same feature contract and a different brief', async () => {
    await runVariationGeneration(input())
    const briefs = generateCandidate.mock.calls.map((call) => call[0].brief)
    expect(new Set(briefs.map((entry: VariationBrief) => entry.id)).size).toBe(4)
    for (const call of generateCandidate.mock.calls) {
      expect(call[0].featureContract).toEqual(plan.featureContract)
    }
  })

  it('keeps viable candidates when one generation fails', async () => {
    generateCandidate.mockRejectedValueOnce(new Error('candidate failed'))
    const result = await runVariationGeneration(input())
    expect(result.finalists).toHaveLength(2)
    expect(events).toContainEqual(expect.objectContaining({ type: 'candidate_failed' }))
  })

  it('emits event-backed phase progress per candidate without raw code', async () => {
    generateCandidate.mockImplementation(async ({ index, onProgress }: { index: number; onProgress: (phase: string) => void }) => {
      onProgress('summary')
      onProgress('markup')
      onProgress('markup')
      return { application: validCandidate(`variant-${index}`), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    })
    await runVariationGeneration(input())
    const progress = events.filter((event) => event.type === 'candidate_progress')
    expect(progress).toHaveLength(8)
    expect(events.some((event) => event.type === 'file_delta')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('<div id="app"')
  })

  it('reports aggregate usage across every candidate', async () => {
    const result = await runVariationGeneration(input())
    expect(result.aggregateUsage).toEqual({ inputTokens: 40, outputTokens: 80, totalTokens: 120 })
  })

  it('reports validation and grading milestones', async () => {
    const result = await runVariationGeneration(input())
    expect(events).toContainEqual({ type: 'variation_validation_started', completedCount: 4 })
    expect(events).toContainEqual({ type: 'variation_validation_complete', eligibleCount: 4 })
    expect(events).toContainEqual({ type: 'variation_grading_started', eligibleCount: 4 })
    expect(events).toContainEqual({ type: 'variation_grading_complete', gradingMode: 'full' })
    expect(result.gradingMode).toBe('full')
  })

  it('throws without persisting partials when fewer than two candidates qualify', async () => {
    generateCandidate.mockImplementation(async ({ index }: { index: number }) => ({
      application: index === 0
        ? validCandidate('kept')
        : { ...validCandidate(`bad-${index}`), files: [
          { path: 'index.html' as const, content: '<div id="app"></div>' },
          { path: 'styles.css' as const, content: 'body{}' },
          { path: 'app.js' as const, content: 'const x = 1' },
        ] },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }))
    await expect(runVariationGeneration(input())).rejects.toThrow(InsufficientVariationCandidatesError)
    // Grading starts per candidate as soon as it individually qualifies, before the whole batch is
    // known to be short on eligible candidates — so the one candidate that did qualify (index 0)
    // still gets graded, even though the run is ultimately discarded.
    expect(gradeCandidate).toHaveBeenCalledTimes(1)
    expect(gradeCandidate.mock.calls[0]![0].candidateIndex).toBe(0)
  })

  it('aborts queued candidates when the user cancels', async () => {
    const controller = new AbortController()
    generateCandidate.mockImplementation(async () => {
      controller.abort(new Error('Generation cancelled by the user.'))
      return { application: validCandidate(), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    })
    await expect(runVariationGeneration(input({ signal: controller.signal }))).rejects.toThrow()
    expect(generateCandidate.mock.calls.length).toBeLessThan(4)
  })

  it('grades every qualifying candidate with the shared prompt and feature contract', async () => {
    await runVariationGeneration(input())
    expect(gradeCandidate).toHaveBeenCalledTimes(4)
    for (const call of gradeCandidate.mock.calls) {
      const context = call[1] as { prompt: string; featureContract: unknown }
      expect(context.prompt).toBe('Show me a few directions for a contact dashboard')
      expect(context.featureContract).toEqual(plan.featureContract)
    }
  })

  it('starts grading a candidate before every sibling has finished generating', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()]
    let taken = 0
    generateCandidate.mockImplementation(async ({ index }: { index: number }) => {
      if (index === 0) return { application: validCandidate('fast'), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      await gates[taken++]!.promise
      return { application: validCandidate(`slow-${index}`), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    })

    const pending = runVariationGeneration(input())
    // Let candidate 0's generate -> validate -> grade chain run to completion while its three
    // siblings are still awaiting their gates.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(gradeCandidate).toHaveBeenCalledTimes(1)
    for (const gate of gates) gate.resolve()
    await pending
    expect(gradeCandidate).toHaveBeenCalledTimes(4)
  })
})
