import { z } from 'zod'

/**
 * Shared vocabulary for the multi-variation workflow. Everything the planner, orchestrator,
 * grader, and persistence layer exchange is declared here so no module has to re-derive the
 * shapes, and so the grading boundary (which must never see briefs, order, or model metadata)
 * stays visible in one place.
 */

export const VARIATION_CANDIDATE_COUNT = 4
export const VARIATION_FINALIST_COUNT = 2
export const VARIATION_CONCURRENCY = 2
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
  designIntent: z.string().trim().min(1).max(400),
  informationArchitecture: z.string().trim().min(1).max(240),
  interactionModel: z.string().trim().min(1).max(240),
  visualDirection: z.string().trim().min(1).max(240),
  density: z.enum(['compact', 'balanced', 'spacious']),
  differentiators: z.array(z.string().trim().min(1).max(180)).min(3).max(6),
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
          designIntent: { type: 'string', maxLength: 400 },
          informationArchitecture: { type: 'string', maxLength: 240 },
          interactionModel: { type: 'string', maxLength: 240 },
          visualDirection: { type: 'string', maxLength: 240 },
          density: { type: 'string', enum: ['compact', 'balanced', 'spacious'] },
          differentiators: { type: 'array', minItems: 3, maxItems: 6, items: { type: 'string', maxLength: 180 } },
        },
      },
    },
  },
} as const
