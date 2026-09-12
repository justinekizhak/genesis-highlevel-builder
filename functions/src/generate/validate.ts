import type { GeneratedApplication } from './application.js'

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

const allowlistedScriptSrc = 'https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js'

function findNonAllowlistedScriptSrc(content: string): string[] {
  const hits: string[] = []
  const scriptSrcPattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi
  for (const match of content.matchAll(scriptSrcPattern)) {
    if (match[1] !== allowlistedScriptSrc) hits.push('loads a script from a non-allowlisted src')
  }
  return hits
}

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
  hits.push(...findNonAllowlistedScriptSrc(content))
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
