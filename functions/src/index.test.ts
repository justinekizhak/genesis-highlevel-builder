import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationEvent } from './shared/protocol.js'

const loadProjectState = vi.fn()
const loadGenerationContext = vi.fn()
const acquireGenerationLock = vi.fn()
const releaseGenerationLock = vi.fn()
const persistUserMessage = vi.fn()
const persistGeneration = vi.fn()
const persistPartialGeneration = vi.fn()
const observeGenerationCancellation = vi.fn()
const generateWithOpenAi = vi.fn()
const planGeneration = vi.fn()
const runVariationGeneration = vi.fn()
const persistVariationFinalists = vi.fn()
const loadVariationSet = vi.fn()
const selectVariationFinalist = vi.fn()
const enforceRateLimit = vi.fn()

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }))
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_options: unknown, handler: unknown) => handler,
}))
vi.mock('./http/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http/auth.js')>()
  return { ...actual, requireFirebaseUser: vi.fn().mockResolvedValue({ uid: 'user-1' }) }
})
vi.mock('./generate/persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/persistence.js')>()
  return {
    ...actual,
    loadProjectState,
    loadGenerationContext,
    acquireGenerationLock,
    releaseGenerationLock,
    persistUserMessage,
    persistGeneration,
    persistPartialGeneration,
    observeGenerationCancellation,
  }
})
vi.mock('./generate/openai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/openai.js')>()
  return { ...actual, generateWithOpenAi }
})
vi.mock('./generate/variation-planner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/variation-planner.js')>()
  return { ...actual, planGeneration }
})
vi.mock('./generate/variation-orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/variation-orchestrator.js')>()
  return { ...actual, runVariationGeneration }
})
vi.mock('./generate/variation-persistence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate/variation-persistence.js')>()
  return { ...actual, persistVariationFinalists, loadVariationSet, selectVariationFinalist }
})
vi.mock('./http/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http/rate-limit.js')>()
  return { ...actual, enforceRateLimit }
})

const application = {
  summary: 'Built a contact dashboard.',
  files: [
    { path: 'index.html' as const, content: '<div id="app"></div>' },
    { path: 'styles.css' as const, content: 'body{}' },
    { path: 'app.js' as const, content: 'console.log(1)' },
  ],
}

const singlePlan = {
  mode: 'single' as const,
  confidence: 0.95,
  featureContract: { requiredFeatures: [], optionalFeatures: [], invariants: [] },
  variants: [],
}

const brief = (id: string) => ({
  id,
  title: `Direction ${id}`,
  designIntent: 'Intent',
  informationArchitecture: 'IA',
  interactionModel: 'Interaction',
  visualDirection: 'Visual',
  density: 'balanced' as const,
  differentiators: ['a', 'b', 'c'],
})

const variationPlan = {
  mode: 'variations' as const,
  confidence: 0.95,
  featureContract: { requiredFeatures: ['Contact search'], optionalFeatures: [], invariants: [] },
  variants: [brief('a'), brief('b'), brief('c'), brief('d')],
}

const finalists = [
  {
    candidateId: 'candidate-a',
    internalRank: 1,
    displayName: 'Direction A' as const,
    summary: 'Direction A summary',
    files: { 'index.html': '<main>A</main>', 'styles.css': 'body{}', 'app.js': '// a' },
    strengths: ['Clear'],
    risks: ['Terse'],
    scoreBreakdown: { featureFidelity: 28 },
    model: 'gpt-5.4-mini',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  },
  {
    candidateId: 'candidate-b',
    internalRank: 2,
    displayName: 'Direction B' as const,
    summary: 'Direction B summary',
    files: { 'index.html': '<main>B</main>', 'styles.css': '.app{}', 'app.js': '// b' },
    strengths: ['Dense'],
    risks: ['Busy'],
    scoreBreakdown: { featureFidelity: 26 },
    model: 'gpt-5.4-mini',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  },
]

function makeResponse() {
  const events: GenerationEvent[] = []
  const response: Record<string, any> = {
    events,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    status: vi.fn(() => response),
    json: vi.fn(() => response),
    flushHeaders: vi.fn(() => { response.headersSent = true }),
    write: vi.fn((chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) events.push(JSON.parse(line.slice('data: '.length)))
      }
      return true
    }),
    end: vi.fn(() => { response.writableEnded = true }),
    on: vi.fn(),
  }
  return response
}

function makeRequest(body: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    originalUrl: '/api/v1/projects/project-1/generations',
    path: '/api/v1/projects/project-1/generations',
    params: {},
    query: {},
    header: vi.fn(),
    body: { prompt: 'Build a contact dashboard', projectId: 'project-1', ...body },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.ENABLE_MULTIPLE_VARIATIONS = 'true'
  loadProjectState.mockResolvedValue({ files: null, messages: [] })
  loadGenerationContext.mockResolvedValue({
    project: { name: 'CRM', description: '', locationId: 'location-1' },
    files: {},
    recentMessages: [],
  })
  acquireGenerationLock.mockResolvedValue(undefined)
  releaseGenerationLock.mockResolvedValue(undefined)
  persistUserMessage.mockResolvedValue(undefined)
  persistGeneration.mockResolvedValue(undefined)
  observeGenerationCancellation.mockResolvedValue(() => undefined)
  enforceRateLimit.mockResolvedValue(undefined)
  generateWithOpenAi.mockImplementation(async (_prompt, _files, _signal, onDelta) => {
    onDelta?.(JSON.stringify(application))
    return application
  })
  planGeneration.mockResolvedValue(singlePlan)
  runVariationGeneration.mockResolvedValue({
    variationSetId: 'set-1',
    finalists,
    gradingMode: 'full',
    eligibleCount: 4,
    aggregateUsage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
  })
  persistVariationFinalists.mockResolvedValue(undefined)
})

describe('API v1 request dispatch', () => {
  it('passes a project ID from the application resource path to the project-state handler', async () => {
    const { apiV1 } = await import('./index.js')
    const request = makeRequest({}, {
      method: 'GET',
      originalUrl: '/api/v1/projects/project%201/application',
      path: '/api/v1/projects/project%201/application',
      body: undefined,
    })
    const response = makeResponse()

    await apiV1(request as never, response as never)

    expect(loadProjectState).toHaveBeenCalledWith('user-1', 'project 1')
    expect(response.json).toHaveBeenCalledWith({ files: null, messages: [] })
  })

  it('reads a variation set through the owner-only route', async () => {
    loadVariationSet.mockResolvedValue({ variationSetId: 'set-1', finalists: [] })
    const { apiV1 } = await import('./index.js')
    const response = makeResponse()
    await apiV1(makeRequest({}, {
      method: 'GET',
      originalUrl: '/api/v1/projects/project-1/variation-sets/set-1',
      path: '/api/v1/projects/project-1/variation-sets/set-1',
      body: undefined,
    }) as never, response as never)

    expect(loadVariationSet).toHaveBeenCalledWith('user-1', 'project-1', 'set-1')
    expect(response.json).toHaveBeenCalledWith({ variationSetId: 'set-1', finalists: [] })
  })

  it('selects a finalist through the owner-only route', async () => {
    selectVariationFinalist.mockResolvedValue({ snapshotId: 'snapshot-a', files: { 'app.js': '// a' } })
    const { apiV1 } = await import('./index.js')
    const response = makeResponse()
    await apiV1(makeRequest({ candidateId: 'candidate-a' }, {
      originalUrl: '/api/v1/projects/project-1/variation-sets/set-1/selection',
      path: '/api/v1/projects/project-1/variation-sets/set-1/selection',
      body: { candidateId: 'candidate-a' },
    }) as never, response as never)

    expect(selectVariationFinalist).toHaveBeenCalledWith({
      uid: 'user-1',
      projectId: 'project-1',
      variationSetId: 'set-1',
      candidateId: 'candidate-a',
    })
    expect(response.json).toHaveBeenCalledWith({ snapshotId: 'snapshot-a', files: { 'app.js': '// a' } })
  })

  it('maps a stale selection to 409', async () => {
    const { VariationSelectionConflictError } = await import('./generate/variation-persistence.js')
    selectVariationFinalist.mockRejectedValue(new VariationSelectionConflictError())
    const { apiV1 } = await import('./index.js')
    const response = makeResponse()
    await apiV1(makeRequest({}, {
      originalUrl: '/api/v1/projects/project-1/variation-sets/set-1/selection',
      path: '/api/v1/projects/project-1/variation-sets/set-1/selection',
      body: { candidateId: 'candidate-a' },
    }) as never, response as never)

    expect(response.status).toHaveBeenCalledWith(409)
  })
})

describe('generateApp branching', () => {
  it('streams single file deltas immediately after a single plan', async () => {
    planGeneration.mockResolvedValue(singlePlan)
    const { generateApp } = await import('./index.js')
    const response = makeResponse()

    await generateApp(makeRequest() as never, response as never)

    const types = response.events.map((event: GenerationEvent) => event.type)
    expect(types).toContain('file_delta')
    expect(types).toContain('complete')
    expect(persistVariationFinalists).not.toHaveBeenCalled()
    expect(runVariationGeneration).not.toHaveBeenCalled()
    expect(enforceRateLimit).toHaveBeenCalledWith('user-1', 'generate-minute', expect.any(Number), 60, expect.anything(), 1)
  })

  it('buffers candidate code and streams only finalist code', async () => {
    planGeneration.mockResolvedValue(variationPlan)
    const { generateApp } = await import('./index.js')
    const response = makeResponse()

    await generateApp(makeRequest() as never, response as never)

    const finalistIds = new Set(['candidate-a', 'candidate-b'])
    expect(response.events.some((event: GenerationEvent) => event.type === 'file_delta')).toBe(false)
    const deltas = response.events.filter((event: any) => event.type === 'finalist_file_delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((event: any) => finalistIds.has(event.candidateId))).toBe(true)
    expect(response.events.at(-1)).toEqual({ type: 'variation_complete', variationSetId: 'set-1' })
    expect(response.events.some((event: GenerationEvent) => event.type === 'complete')).toBe(false)
    expect(persistGeneration).not.toHaveBeenCalled()
    expect(enforceRateLimit).toHaveBeenCalledWith('user-1', 'generate-minute', expect.any(Number), 60, expect.anything(), 4)
  })

  it('emits finalist metadata only after finalists are persisted', async () => {
    planGeneration.mockResolvedValue(variationPlan)
    const order: string[] = []
    persistVariationFinalists.mockImplementation(async () => { order.push('persist') })
    const { generateApp } = await import('./index.js')
    const response = makeResponse()
    response.write = vi.fn((chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const event = JSON.parse(line.slice('data: '.length))
        response.events.push(event)
        if (event.type === 'finalist_metadata') order.push('metadata')
      }
      return true
    })

    await generateApp(makeRequest() as never, response as never)

    expect(order).toEqual(['persist', 'metadata'])
    expect(persistVariationFinalists).toHaveBeenCalledWith(expect.objectContaining({
      variationSetId: 'set-1',
      finalists,
    }))
  })

  it('leaves active files unchanged with fewer than two qualified candidates', async () => {
    const { InsufficientVariationCandidatesError } = await import('./generate/variation-orchestrator.js')
    planGeneration.mockResolvedValue(variationPlan)
    runVariationGeneration.mockRejectedValue(new InsufficientVariationCandidatesError())
    const { generateApp } = await import('./index.js')
    const response = makeResponse()

    await generateApp(makeRequest() as never, response as never)

    expect(persistGeneration).not.toHaveBeenCalled()
    expect(persistVariationFinalists).not.toHaveBeenCalled()
    expect(response.events).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'VARIATION_INSUFFICIENT_CANDIDATES',
    }))
  })

  it('never persists a partial generation for a failed variation batch', async () => {
    planGeneration.mockResolvedValue(variationPlan)
    runVariationGeneration.mockRejectedValue(new Error('grading exploded'))
    const { generateApp } = await import('./index.js')

    await generateApp(makeRequest() as never, makeResponse() as never)

    expect(persistPartialGeneration).not.toHaveBeenCalled()
  })

  it('coerces a variation plan to the single branch while the rollout flag is off', async () => {
    process.env.ENABLE_MULTIPLE_VARIATIONS = 'false'
    planGeneration.mockResolvedValue(variationPlan)
    const { generateApp } = await import('./index.js')
    const response = makeResponse()

    await generateApp(makeRequest() as never, response as never)

    const types = response.events.map((event: GenerationEvent) => event.type)
    expect(types).toContain('file_delta')
    expect(types).toContain('complete')
    expect(runVariationGeneration).not.toHaveBeenCalled()
    expect(persistVariationFinalists).not.toHaveBeenCalled()
    expect(enforceRateLimit).toHaveBeenCalledWith('user-1', 'generate-minute', expect.any(Number), 60, expect.anything(), 1)
  })

  it('announces planning before it classifies the request', async () => {
    const { generateApp } = await import('./index.js')
    const response = makeResponse()
    await generateApp(makeRequest() as never, response as never)
    const types = response.events.map((event: GenerationEvent) => event.type)
    expect(types[0]).toBe('generation_started')
    expect(types[1]).toBe('variation_planning_started')
  })
})
