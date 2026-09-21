import { generatedApplicationSchema, type GeneratedApplication } from './application.js'
import type { FeatureContract } from './variation-types.js'

export class UnsafeGenerationError extends Error {}

type BannedPattern = { pattern: RegExp; reason: string }

const bannedPatterns: BannedPattern[] = [
  { pattern: /\bfetch\s*\(/, reason: 'calls fetch() directly instead of the injected HighLevel bridge' },
  { pattern: /\bXMLHttpRequest\b/, reason: 'uses XMLHttpRequest instead of the injected HighLevel bridge' },
  { pattern: /\bnew\s+WebSocket\s*\(/, reason: 'opens a WebSocket connection' },
  { pattern: /\beval\s*\(/, reason: 'calls eval()' },
  { pattern: /\bnew\s+Function\s*\(/, reason: 'constructs a Function from a string' },
  { pattern: /\blocalStorage\b/, reason: 'accesses localStorage' },
  { pattern: /\bsessionStorage\b/, reason: 'accesses sessionStorage' },
  { pattern: /\bdocument\.cookie\b/, reason: 'reads or writes document.cookie' },
  { pattern: /\bwindow\.top\b/, reason: 'reaches for window.top' },
  { pattern: /\bwindow\.parent\.(?!postMessage\b)/, reason: 'reaches into window.parent outside the bridge' },
]

const secretShapedPatterns: BannedPattern[] = [
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/, reason: 'contains an OpenAI-shaped secret key' },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/, reason: 'contains a Google API-shaped secret key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, reason: 'contains a GitHub-shaped secret token' },
  { pattern: /\b(?:api|secret|access)[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9/+_-]{24,}["']/i, reason: 'assigns a secret-shaped literal to a key/token field' },
]

export function findUnsafePatterns(content: string): string[] {
  const hits: string[] = []
  for (const { pattern, reason } of [...bannedPatterns, ...secretShapedPatterns]) {
    if (pattern.test(content)) hits.push(reason)
  }
  return hits
}

/**
 * Second, testable layer behind the srcdoc sandbox/CSP: the prompt instructs the model never to
 * emit these APIs, but nothing previously verified compliance before persisting the output.
 */
export function validateGeneratedApplication(application: GeneratedApplication): void {
  for (const file of application.files) {
    const hits = findUnsafePatterns(file.content)
    if (hits.length) {
      throw new UnsafeGenerationError(`Generated ${file.path} was rejected: ${hits.join('; ')}.`)
    }
  }
}

export type QualificationCheckId =
  | 'schema'
  | 'security'
  | 'vue-runtime'
  | 'javascript'
  | 'highlevel-contracts'
  | 'states'
  | 'features'
  | 'accessibility'
  | 'responsive'

export type QualificationCheck = {
  id: QualificationCheckId
  passed: boolean
  hardFailure: boolean
  evidence: string[]
}

export type QualificationResult = {
  eligible: boolean
  deterministicScore: number
  checks: QualificationCheck[]
}

/** Fixed soft-check points. Their sum is exactly 100 so the deterministic score is a percentage. */
export const qualificationSoftPoints = {
  'highlevel-contracts': 25,
  states: 20,
  features: 30,
  accessibility: 15,
  responsive: 10,
} as const satisfies Partial<Record<QualificationCheckId, number>>

const VUE_RUNTIME_TAG = '<script src="https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js"></script>'

const supportedBridgeOperations = new Set([
  'contacts.list',
  'contacts.create',
  'contacts.update',
  'conversations.list',
  'conversations.messages',
  'conversations.send',
  'calendars.list',
  'calendars.availability',
  'appointments.list',
  'events.subscribe',
])

function fileContent(application: GeneratedApplication, path: string) {
  return application.files?.find((file) => file.path === path)?.content ?? ''
}

function featureEvidence(feature: string, haystack: string) {
  const words = feature.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3)
  const lowered = haystack.toLowerCase()
  if (!words.length) return lowered.includes(feature.toLowerCase())
  return words.every((word) => lowered.includes(word))
}

/**
 * Deterministic, model-free qualification used by the variation workflow. Hard failures make a
 * candidate ineligible outright; soft checks produce cited evidence and a bounded score that both
 * feeds the final grade and stands in for the model grader when it is unavailable.
 */
export function qualifyGeneratedApplication(
  application: GeneratedApplication,
  contract: FeatureContract,
): QualificationResult {
  const checks: QualificationCheck[] = []
  const markup = fileContent(application, 'index.html')
  const styles = fileContent(application, 'styles.css')
  const script = fileContent(application, 'app.js')

  const parsedSchema = generatedApplicationSchema.safeParse(application)
  checks.push({
    id: 'schema',
    passed: parsedSchema.success,
    hardFailure: !parsedSchema.success,
    evidence: parsedSchema.success
      ? ['index.html, styles.css, and app.js are present and within size limits']
      : parsedSchema.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'application'}: ${issue.message}`),
  })

  const unsafeHits = (application.files ?? []).flatMap((file) => findUnsafePatterns(file.content).map((reason) => `${file.path} ${reason}`))
  checks.push({
    id: 'security',
    passed: unsafeHits.length === 0,
    hardFailure: unsafeHits.length > 0,
    evidence: unsafeHits.length ? unsafeHits : ['No forbidden APIs, credentials, or unsafe HTML behavior found'],
  })

  const hasVueRuntime = markup.includes(VUE_RUNTIME_TAG)
  checks.push({
    id: 'vue-runtime',
    passed: hasVueRuntime,
    hardFailure: !hasVueRuntime,
    evidence: [hasVueRuntime
      ? 'index.html loads the mandatory global Vue runtime'
      : 'index.html is missing the mandatory global Vue runtime tag'],
  })

  // Constructing a Function parses the source without ever running it; generated code is never executed here.
  let parseError = ''
  try {
    // eslint-disable-next-line no-new-func
    new Function(script)
  } catch (cause) {
    parseError = cause instanceof Error ? cause.message : 'app.js could not be parsed'
  }
  checks.push({
    id: 'javascript',
    passed: !parseError,
    hardFailure: Boolean(parseError),
    evidence: [parseError ? `app.js does not parse: ${parseError}` : 'app.js parses as JavaScript'],
  })

  const referenced = [...script.matchAll(/window\.genesis\.highlevel\.(\w+)\.(\w+)\s*\(/g)].map((match) => `${match[1]}.${match[2]}`)
  const unsupported = [...new Set(referenced.filter((operation) => !supportedBridgeOperations.has(operation)))]
  checks.push({
    id: 'highlevel-contracts',
    passed: unsupported.length === 0,
    hardFailure: false,
    evidence: unsupported.length
      ? unsupported.map((operation) => `app.js calls unsupported bridge operation ${operation}`)
      : [referenced.length ? `app.js uses supported bridge operations: ${[...new Set(referenced)].join(', ')}` : 'app.js calls no HighLevel bridge operations'],
  })

  const stateHaystack = `${markup}\n${script}`
  const missingStates = ([['loading', /loading/i], ['error', /error/i], ['empty', /empty|no results|nothing (?:yet|here)/i]] as const)
    .filter(([, pattern]) => !pattern.test(stateHaystack))
    .map(([name]) => name)
  checks.push({
    id: 'states',
    passed: missingStates.length === 0,
    hardFailure: false,
    evidence: missingStates.length
      ? [`No static evidence of these states: ${missingStates.join(', ')}`]
      : ['Loading, error, and empty states have static evidence'],
  })

  const featureHaystack = `${markup}\n${script}\n${application.summary ?? ''}`
  const missingFeatures = contract.requiredFeatures.filter((feature) => !featureEvidence(feature, featureHaystack))
  checks.push({
    id: 'features',
    passed: missingFeatures.length === 0,
    hardFailure: false,
    evidence: missingFeatures.length
      ? missingFeatures.map((feature) => `No markup or code evidence for required feature: ${feature}`)
      : contract.requiredFeatures.map((feature) => `Evidence found for required feature: ${feature}`)
        .concat(contract.requiredFeatures.length ? [] : ['No required features were declared']),
  })

  const accessible = /aria-[a-z]+=|<label\b|role="/i.test(markup)
  checks.push({
    id: 'accessibility',
    passed: accessible,
    hardFailure: false,
    evidence: [accessible
      ? 'index.html carries accessible names or semantic labelling'
      : 'index.html has no accessible names, labels, or roles'],
  })

  const responsive = /@media|minmax\(|auto-fit|auto-fill|clamp\(/i.test(styles)
  checks.push({
    id: 'responsive',
    passed: responsive,
    hardFailure: false,
    evidence: [responsive
      ? 'styles.css contains responsive rules'
      : 'styles.css contains no media queries or fluid sizing'],
  })

  const hasHardFailure = checks.some((check) => check.hardFailure)
  const deterministicScore = hasHardFailure ? 0 : checks.reduce((total, check) => {
    const points = qualificationSoftPoints[check.id as keyof typeof qualificationSoftPoints]
    return total + (points && check.passed ? points : 0)
  }, 0)

  return { eligible: !hasHardFailure, deterministicScore, checks }
}
