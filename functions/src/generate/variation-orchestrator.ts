import { createHash, randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import type { GeneratedApplication } from './application.js'
import { mapWithConcurrency } from './concurrency.js'
import { generateWithOpenAi } from './openai.js'
import type { GenerationContext } from './persistence.js'
import { StructuredApplicationStream } from './structured-stream.js'
import { qualifyGeneratedApplication, type QualificationResult } from './validate.js'
import { gradeCandidate, rankGradedCandidates, type GradeCandidateResult, type GraderCandidate } from './variation-grader.js'
import {
  VARIATION_CANDIDATE_COUNT,
  VARIATION_CONCURRENCY,
  VARIATION_FINALIST_COUNT,
  type FeatureContract,
  type GenerationPlan,
  type GradingMode,
  type RubricScore,
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
  standout: string
  scoreBreakdown: Record<string, number>
  model: string
  usage: TokenUsage
  /** The creative brief this candidate was generated from — kept out of the grader, exposed here for transparency. */
  brief: VariationBrief
  /** Absent only when grading fell back to `deterministicRanking`, which never calls the rubric model. */
  rubric?: RubricScore
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

// Re-exported so existing callers/tests that imported the pool from here keep working; the
// implementation now lives in concurrency.js so variation-grader.ts can use it too without a
// circular import back through this module.
export { mapWithConcurrency }

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
  const startedAt = Date.now()
  try {
    const result = await runVariationGenerationInner(input)
    logger.info('perf.operation', {
      operation: 'variation.run',
      durationMs: Date.now() - startedAt,
      variationSetId: result.variationSetId,
      gradingMode: result.gradingMode,
      eligibleCount: result.eligibleCount,
    })
    return result
  } catch (error) {
    logger.warn('perf.operation', {
      operation: 'variation.run',
      durationMs: Date.now() - startedAt,
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function runVariationGenerationInner(input: VariationRunInput): Promise<VariationRunResult> {
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

  let gradingStarted = false
  let gradedCount = 0
  const startGrading = () => {
    if (gradingStarted) return
    gradingStarted = true
    input.onEvent({ type: 'variation_grading_started', eligibleCount: VARIATION_CANDIDATE_COUNT })
  }

  type PipelinedEntry = {
    task: CandidateTask
    result: CandidateResult
    qualification: QualificationResult
    grading: GradeCandidateResult | null
  }

  // Each candidate runs generate -> validate -> (if eligible) grade as one chain, so a candidate's
  // grading call fires the moment IT is ready and overlaps with siblings still generating, instead
  // of every candidate waiting for the whole batch to finish generating before grading starts for
  // any of them. Because VARIATION_CONCURRENCY equals the candidate count, every chain runs fully
  // in parallel with the others; a candidate that ultimately gets discarded (e.g. the run ends up
  // short on qualifying candidates) may still have spent a grading call — an acceptable trade for
  // not paying the full generation tail before grading can even begin on the common path.
  const settled = await mapWithConcurrency(tasks, VARIATION_CONCURRENCY, input.signal, async (task): Promise<PipelinedEntry> => {
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

    const qualification = qualifyGeneratedApplication(result.application, featureContract)
    if (!qualification.eligible) {
      return { task, result, qualification, grading: null }
    }

    startGrading()
    const graderCandidate: GraderCandidate = {
      candidateId: task.candidateId,
      candidateIndex: task.index,
      brief: task.brief,
      model: input.model,
      application: result.application,
      qualification,
      usage: result.usage,
    }
    const grading = await gradeCandidate(graderCandidate, { prompt: input.prompt, featureContract, signal: input.signal })
    gradedCount += 1
    input.onEvent({ type: 'variation_grading_progress', completedCount: gradedCount, totalCount: VARIATION_CANDIDATE_COUNT })
    return { task, result, qualification, grading }
  })

  const completed: PipelinedEntry[] = []
  for (const [index, outcome] of settled.entries()) {
    const task = tasks[index]!
    if (outcome.status === 'fulfilled') {
      completed.push(outcome.value)
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
  const qualified = completed.filter((entry) => entry.qualification.eligible)
  input.onEvent({ type: 'variation_validation_complete', eligibleCount: qualified.length })

  if (qualified.length < VARIATION_FINALIST_COUNT) {
    throw new InsufficientVariationCandidatesError()
  }

  const graderCandidates: GraderCandidate[] = qualified.map((entry) => ({
    candidateId: entry.task.candidateId,
    candidateIndex: entry.task.index,
    brief: entry.task.brief,
    model: input.model,
    application: entry.result.application,
    qualification: entry.qualification,
    usage: entry.result.usage,
  }))
  const gradingResults = qualified.map((entry) => entry.grading!)
  const grading = rankGradedCandidates(graderCandidates, gradingResults)
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
        standout: ranked.standout,
        scoreBreakdown: ranked.scoreBreakdown,
        model: input.model,
        usage: entry.result.usage,
        brief: entry.task.brief,
        rubric: ranked.rubric,
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
