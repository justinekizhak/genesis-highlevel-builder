import { createHash, randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import type { GeneratedApplication } from './application.js'
import { generateWithOpenAi } from './openai.js'
import type { GenerationContext } from './persistence.js'
import { StructuredApplicationStream } from './structured-stream.js'
import { qualifyGeneratedApplication, type QualificationResult } from './validate.js'
import { gradeVariations, type GraderCandidate } from './variation-grader.js'
import {
  VARIATION_CANDIDATE_COUNT,
  VARIATION_CONCURRENCY,
  VARIATION_FINALIST_COUNT,
  type FeatureContract,
  type GenerationPlan,
  type GradingMode,
  type TokenUsage,
  type VariationBrief,
} from './variation-types.js'
import type { CandidatePhase, GenerationEvent, VariationDisplayName } from '../shared/protocol.js'

export class InsufficientVariationCandidatesError extends Error {
  constructor(message = 'Fewer than two candidates qualified, so no variation was saved and your project is unchanged.') {
    super(message)
  }
}

export type CandidateTask = {
  candidateId: string
  index: number
  brief: VariationBrief
  featureContract: FeatureContract
  onProgress: (phase: CandidatePhase) => void
}

export type CandidateResult = {
  application: GeneratedApplication
  usage: TokenUsage
}

export type CandidateGenerator = (task: CandidateTask) => Promise<CandidateResult>

export type VariationFinalist = {
  candidateId: string
  internalRank: number
  displayName: VariationDisplayName
  summary: string
  files: Record<string, string>
  strengths: string[]
  risks: string[]
  scoreBreakdown: Record<string, number>
  model: string
  usage: TokenUsage
}

export type VariationRunResult = {
  variationSetId: string
  finalists: VariationFinalist[]
  gradingMode: GradingMode
  eligibleCount: number
  aggregateUsage: TokenUsage
}

export type VariationRunInput = {
  prompt: string
  plan: GenerationPlan
  currentFiles: Record<string, string>
  model: string
  signal: AbortSignal
  onEvent: (event: GenerationEvent) => void
  context?: GenerationContext
  variationSetId?: string
  generateCandidate?: CandidateGenerator
}

const phaseForPath = { 'index.html': 'markup', 'styles.css': 'styles', 'app.js': 'logic' } as const

/**
 * Bounded worker pool. Results keep input order and failures are captured rather than thrown, so
 * one failed candidate never cancels a viable sibling; only an abort stops the pool.
 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      signal.throwIfAborted()
      const index = cursor++
      try { results[index] = { status: 'fulfilled', value: await worker(values[index]!, index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Real candidate generation. The structured stream is consumed for coarse phase milestones only —
 * its file events are deliberately dropped so no candidate code ever reaches the client before
 * grading picks two finalists.
 */
function defaultCandidateGenerator(input: VariationRunInput): CandidateGenerator {
  return async (task) => {
    const parser = new StructuredApplicationStream()
    const emitted = new Set<CandidatePhase>()
    const emit = (phase: CandidatePhase) => {
      if (emitted.has(phase)) return
      emitted.add(phase)
      task.onProgress(phase)
    }
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const application = await generateWithOpenAi(
      input.prompt,
      input.currentFiles,
      input.signal,
      (delta) => {
        for (const event of parser.push(delta)) {
          if (event.type === 'token') emit('summary')
          if (event.type === 'file_start') emit(phaseForPath[event.path as keyof typeof phaseForPath] ?? 'logic')
        }
      },
      input.context,
      input.model,
      (reported) => { usage = reported },
      { featureContract: task.featureContract, variationBrief: task.brief },
    )
    return { application, usage }
  }
}

function displayNamesFor(variationSetId: string): [VariationDisplayName, VariationDisplayName] {
  // Display position must not encode internal rank, but it must be stable across reloads, so it is
  // derived from the variation-set ID rather than from the ranking or from randomness.
  const flip = createHash('sha256').update(variationSetId).digest()[0]! % 2 === 1
  return flip ? ['Direction B', 'Direction A'] : ['Direction A', 'Direction B']
}

export async function runVariationGeneration(input: VariationRunInput): Promise<VariationRunResult> {
  const briefs = input.plan.variants
  if (briefs.length !== VARIATION_CANDIDATE_COUNT) {
    throw new Error(`A variation run requires exactly ${VARIATION_CANDIDATE_COUNT} briefs.`)
  }
  const variationSetId = input.variationSetId ?? randomUUID()
  const generate = input.generateCandidate ?? defaultCandidateGenerator(input)
  const featureContract = input.plan.featureContract

  input.onEvent({ type: 'variation_set_started', variationSetId, count: VARIATION_CANDIDATE_COUNT })

  const tasks: CandidateTask[] = briefs.map((brief, index) => ({
    candidateId: randomUUID(),
    index,
    brief,
    featureContract,
    onProgress: () => undefined,
  }))

  const settled = await mapWithConcurrency(tasks, VARIATION_CONCURRENCY, input.signal, async (task) => {
    input.onEvent({ type: 'candidate_started', candidateId: task.candidateId, index: task.index })
    const emitted = new Set<CandidatePhase>()
    const result = await generate({
      ...task,
      onProgress: (phase) => {
        if (emitted.has(phase)) return
        emitted.add(phase)
        input.onEvent({ type: 'candidate_progress', candidateId: task.candidateId, phase })
      },
    })
    input.onEvent({ type: 'candidate_complete', candidateId: task.candidateId })
    return result
  })

  const completed: Array<{ task: CandidateTask; result: CandidateResult }> = []
  for (const [index, outcome] of settled.entries()) {
    const task = tasks[index]!
    if (outcome.status === 'fulfilled') {
      completed.push({ task, result: outcome.value })
      continue
    }
    logger.warn('Variation candidate failed', {
      variationSetId,
      candidateId: task.candidateId,
      reason: outcome.reason instanceof Error ? outcome.reason.message : 'unknown',
    })
    input.onEvent({ type: 'candidate_failed', candidateId: task.candidateId, recoverable: true })
  }

  const aggregateUsage = completed.reduce<TokenUsage>((total, entry) => ({
    inputTokens: total.inputTokens + entry.result.usage.inputTokens,
    outputTokens: total.outputTokens + entry.result.usage.outputTokens,
    totalTokens: total.totalTokens + entry.result.usage.totalTokens,
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 })

  input.onEvent({ type: 'variation_validation_started', completedCount: completed.length })
  const qualified = completed
    .map((entry) => ({ ...entry, qualification: qualifyGeneratedApplication(entry.result.application, featureContract) }))
    .filter((entry) => entry.qualification.eligible)
  input.onEvent({ type: 'variation_validation_complete', eligibleCount: qualified.length })

  if (qualified.length < VARIATION_FINALIST_COUNT) {
    throw new InsufficientVariationCandidatesError()
  }

  input.onEvent({ type: 'variation_grading_started', eligibleCount: qualified.length })
  const graderCandidates: GraderCandidate[] = qualified.map((entry) => ({
    candidateId: entry.task.candidateId,
    candidateIndex: entry.task.index,
    brief: entry.task.brief,
    model: input.model,
    application: entry.result.application,
    qualification: entry.qualification as QualificationResult,
    usage: entry.result.usage,
  }))
  const grading = await gradeVariations({
    prompt: input.prompt,
    featureContract,
    candidates: graderCandidates,
    signal: input.signal,
  })
  input.onEvent({ type: 'variation_grading_complete', gradingMode: grading.gradingMode })

  const byCandidateId = new Map(qualified.map((entry) => [entry.task.candidateId, entry]))
  const displayNames = displayNamesFor(variationSetId)
  const finalists = grading.ranked
    .filter((ranked) => ranked.candidateId && byCandidateId.has(ranked.candidateId))
    .slice(0, VARIATION_FINALIST_COUNT)
    .map((ranked, position) => {
      const entry = byCandidateId.get(ranked.candidateId!)!
      return {
        candidateId: ranked.candidateId!,
        internalRank: position + 1,
        displayName: displayNames[position]!,
        summary: entry.result.application.summary,
        files: Object.fromEntries(entry.result.application.files.map((file) => [file.path, file.content])),
        strengths: ranked.strengths,
        risks: ranked.risks,
        scoreBreakdown: ranked.scoreBreakdown,
        model: input.model,
        usage: entry.result.usage,
      } satisfies VariationFinalist
    })

  if (finalists.length < VARIATION_FINALIST_COUNT) throw new InsufficientVariationCandidatesError()

  return {
    variationSetId,
    finalists,
    gradingMode: grading.gradingMode,
    eligibleCount: qualified.length,
    aggregateUsage,
  }
}
