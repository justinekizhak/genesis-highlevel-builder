import { z } from 'zod'

/**
 * Shared vocabulary for the multi-variation workflow. Everything the planner, orchestrator,
 * grader, and persistence layer exchange is declared here so no module has to re-derive the
 * shapes, and so the grading boundary (which must never see briefs, order, or model metadata)
 * stays visible in one place.
 */

export const VARIATION_CANDIDATE_COUNT = 4
export const VARIATION_FINALIST_COUNT = 2
export const VARIATION_CONCURRENCY = VARIATION_CANDIDATE_COUNT
export const VARIATION_CONFIDENCE_FLOOR = 0.8

const boundedList = (max: number, itemMax: number) => z.array(z.string().trim().min(1).max(itemMax)).max(max)

export const featureContractSchema = z.object({
  requiredFeatures: boundedList(20, 240),
  optionalFeatures: boundedList(20, 240),
  invariants: boundedList(20, 240),
}).strict()

export type FeatureContract = z.infer<typeof featureContractSchema>

export const variationBriefSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(80),
  designIntent: z.string().trim().min(1).max(180),
  informationArchitecture: z.string().trim().min(1).max(130),
  interactionModel: z.string().trim().min(1).max(130),
  visualDirection: z.string().trim().min(1).max(130),
  density: z.enum(['compact', 'balanced', 'spacious']),
  differentiators: z.array(z.string().trim().min(1).max(90)).min(3).max(6),
}).strict()

export type VariationBrief = z.infer<typeof variationBriefSchema>

export const generationPlanSchema = z.object({
  mode: z.enum(['single', 'variations']),
  confidence: z.number().min(0).max(1),
  featureContract: featureContractSchema,
  variants: z.array(variationBriefSchema).max(VARIATION_CANDIDATE_COUNT),
}).strict().superRefine((plan, context) => {
  const expected = plan.mode === 'variations' ? VARIATION_CANDIDATE_COUNT : 0
  if (plan.variants.length !== expected) {
    context.addIssue({ code: 'custom', path: ['variants'], message: `Expected ${expected} variation briefs.` })
  }
})

export type GenerationPlan = z.infer<typeof generationPlanSchema>

export const singleGenerationPlan: GenerationPlan = Object.freeze({
  mode: 'single',
  confidence: 0,
  featureContract: { requiredFeatures: [], optionalFeatures: [], invariants: [] },
  variants: [],
})

/** Structured-output schema for the planning call; mirrors `generationPlanSchema`. */
export const generationPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'confidence', 'featureContract', 'variants'],
  properties: {
    mode: { type: 'string', enum: ['single', 'variations'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    featureContract: {
      type: 'object',
      additionalProperties: false,
      required: ['requiredFeatures', 'optionalFeatures', 'invariants'],
      properties: {
        requiredFeatures: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
        optionalFeatures: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
        invariants: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 240 } },
      },
    },
    variants: {
      type: 'array',
      maxItems: VARIATION_CANDIDATE_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'title', 'designIntent', 'informationArchitecture',
          'interactionModel', 'visualDirection', 'density', 'differentiators',
        ],
        properties: {
          id: { type: 'string', maxLength: 40 },
          title: { type: 'string', maxLength: 80 },
          designIntent: {
            type: 'string',
            maxLength: 180,
            description: 'One concise sentence naming the core idea — not a paragraph.',
          },
          informationArchitecture: {
            type: 'string',
            maxLength: 130,
            description: 'A short phrase naming the layout structure, e.g. "three-panel dashboard with a persistent sidebar".',
          },
          interactionModel: {
            type: 'string',
            maxLength: 130,
            description: 'A short phrase naming how the user interacts, e.g. "inline editing with autosave".',
          },
          visualDirection: {
            type: 'string',
            maxLength: 130,
            description: 'A short phrase naming the visual style, e.g. "flat, high-contrast, generous whitespace".',
          },
          density: { type: 'string', enum: ['compact', 'balanced', 'spacious'] },
          differentiators: {
            type: 'array',
            minItems: 3,
            maxItems: 6,
            items: {
              type: 'string',
              maxLength: 90,
              description: 'A short fragment (≤12 words) naming one thing that sets this direction apart — not a full sentence.',
            },
          },
        },
      },
    },
  },
} as const

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export const evidencePathSchema = z.enum(['index.html', 'styles.css', 'app.js'])

/** 100-point rubric. Criterion maxima are the weights from the design spec and sum to 100. */
export const rubricCriteria = {
  featureFidelity: 30,
  functionalCorrectness: 25,
  robustness: 15,
  usability: 10,
  accessibility: 10,
  responsiveness: 5,
  maintainability: 5,
} as const

export type RubricCriterion = keyof typeof rubricCriteria

export const rubricSchema = z.object({
  alias: z.string(),
  featureFidelity: z.number().int().min(0).max(30),
  functionalCorrectness: z.number().int().min(0).max(25),
  robustness: z.number().int().min(0).max(15),
  usability: z.number().int().min(0).max(10),
  accessibility: z.number().int().min(0).max(10),
  responsiveness: z.number().int().min(0).max(5),
  maintainability: z.number().int().min(0).max(5),
  standout: z.string().trim().min(1).max(160),
  evidence: z.array(z.object({ path: evidencePathSchema, detail: z.string().max(110) })).max(4),
}).strict()

export type RubricScore = z.infer<typeof rubricSchema>

export type CandidateScore = {
  alias: string
  rubric: RubricScore
  deterministicScore: number
}

export type RankedCandidate = {
  alias: string
  candidateId?: string
  internalRank: number
  rubricScore: number
  rubric?: RubricScore
  scoreBreakdown: Record<string, number>
  standout: string
}

export type GradingMode = 'full' | 'deterministic_fallback'

const rubricJsonProperties = Object.fromEntries(
  Object.entries(rubricCriteria).map(([criterion, maximum]) => [criterion, { type: 'integer', minimum: 0, maximum }]),
)

export const rubricJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['alias', ...Object.keys(rubricCriteria), 'standout', 'evidence'],
  properties: {
    alias: { type: 'string' },
    ...rubricJsonProperties,
    standout: {
      type: 'string',
      maxLength: 160,
      description: 'One short, plain sentence (≤20 words) telling the end user the single most decision-relevant '
        + 'thing that distinguishes this candidate, so they can choose quickly. Name the exact feature, layout '
        + 'choice, or interaction — never generic praise, never scores or rubric language.',
    },
    evidence: {
      type: 'array',
      maxItems: 4,
      description: 'Two to four short citations, each one concrete fact — not a running commentary.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'detail'],
        properties: {
          path: { type: 'string', enum: ['index.html', 'styles.css', 'app.js'] },
          detail: {
            type: 'string',
            maxLength: 110,
            description: 'One short clause (≤15 words) naming the concrete implementation fact — not a full sentence of prose.',
          },
        },
      },
    },
  },
} as const
