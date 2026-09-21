import { describe, expect, it } from 'vitest'
import {
  findUnsafePatterns,
  qualificationSoftPoints,
  qualifyGeneratedApplication,
  UnsafeGenerationError,
  validateGeneratedApplication,
} from './validate.js'
import type { FeatureContract } from './variation-types.js'

const clean = {
  summary: 'Built a contact dashboard.',
  files: [
    { path: 'index.html' as const, content: '<main id="root"></main>' },
    { path: 'styles.css' as const, content: 'main { padding: 16px; }' },
    { path: 'app.js' as const, content: 'window.genesis.highlevel.contacts.list({}).then((data) => render(data))' },
  ],
}

describe('generated-output validator', () => {
  it('passes clean bridge-only output', () => {
    expect(() => validateGeneratedApplication(clean)).not.toThrow()
  })

  it.each([
    ['fetch(', 'fetch("https://evil.example.com")'],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['WebSocket', "new WebSocket('wss://evil.example.com')"],
    ['eval', 'eval("1+1")'],
    ['new Function', 'new Function("return 1")()'],
    ['localStorage', 'localStorage.setItem("a", "b")'],
    ['sessionStorage', 'sessionStorage.getItem("a")'],
    ['document.cookie', 'document.cookie = "a=b"'],
    ['window.top', 'window.top.location.href'],
    ['window.parent (non-bridge)', 'window.parent.document.write("x")'],
    ['OpenAI-shaped key', 'const key = "sk-abcdefghijklmnopqrstuvwx"'],
    ['Google-shaped key', 'const key = "AIzaSyA1234567890abcdefghijklmno1234"'],
    ['GitHub-shaped token', 'const token = "ghp_abcdefghijklmnopqrstuvwxyz012345"'],
    ['generic secret literal', 'const apiKey = "abcdefghijklmnopqrstuvwx1234567"'],
  ])('flags %s', (_label, snippet) => {
    const application = { ...clean, files: [clean.files[0]!, clean.files[1]!, { path: 'app.js' as const, content: snippet }] }
    expect(findUnsafePatterns(snippet).length).toBeGreaterThan(0)
    expect(() => validateGeneratedApplication(application)).toThrow(UnsafeGenerationError)
  })

  it('allows window.parent.postMessage (the bridge itself)', () => {
    expect(findUnsafePatterns('window.parent.postMessage({ channel: "genesis.highlevel.v1" }, "*")')).toEqual([])
  })

  it('allows script tags from any src (CSP handles origin restriction)', () => {
    expect(findUnsafePatterns('<script src="https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js"></script>')).toEqual([])
  })
})

const vueTag = '<script src="https://cdn.jsdelivr.net/npm/vue@3.5.20/dist/vue.global.prod.js"></script>'

const contract: FeatureContract = {
  requiredFeatures: ['Contact search'],
  optionalFeatures: [],
  invariants: ['Use HighLevel contacts'],
}

const qualified = {
  summary: 'Built a contact dashboard.',
  files: [
    { path: 'index.html' as const, content: `${vueTag}\n<div id="app" v-cloak><label for="q">Contact search</label><input id="q" aria-label="Contact search"></div>` },
    { path: 'styles.css' as const, content: ':root { color-scheme: dark; }\n@media (max-width: 700px) { body { padding: 8px; } }' },
    {
      path: 'app.js' as const,
      content: 'const state = { loading: true, error: null, contacts: [] };\nasync function load() { const response = await window.genesis.highlevel.contacts.list({}); state.contacts = response.contacts; if (!state.contacts.length) { state.empty = true } }\nload()',
    },
  ],
}

function withFile(path: 'index.html' | 'styles.css' | 'app.js', content: string) {
  return { ...qualified, files: qualified.files.map((file) => file.path === path ? { ...file, content } : file) }
}

describe('variation qualification', () => {
  it('keeps validateGeneratedApplication backward compatible', () => {
    expect(() => validateGeneratedApplication(qualified)).not.toThrow()
  })

  it('scores soft checks on fixed points that sum to one hundred', () => {
    expect(Object.values(qualificationSoftPoints).reduce((total, points) => total + points, 0)).toBe(100)
  })

  it('qualifies a clean application with full deterministic evidence', () => {
    const result = qualifyGeneratedApplication(qualified, contract)
    expect(result.eligible).toBe(true)
    expect(result.deterministicScore).toBe(100)
    expect(result.checks.every((check) => check.passed)).toBe(true)
    expect(result.checks.find((check) => check.id === 'features')?.evidence.join(' ')).toContain('Contact search')
  })

  it('makes a security failure a hard, ineligible failure', () => {
    const result = qualifyGeneratedApplication(withFile('app.js', 'fetch("https://evil.example.com")'), contract)
    const security = result.checks.find((check) => check.id === 'security')
    expect(security).toMatchObject({ passed: false, hardFailure: true })
    expect(result.eligible).toBe(false)
  })

  it('rejects a missing mandatory Vue runtime tag', () => {
    const result = qualifyGeneratedApplication(withFile('index.html', '<div id="app"></div>'), contract)
    expect(result.checks.find((check) => check.id === 'vue-runtime')).toMatchObject({ passed: false, hardFailure: true })
    expect(result.eligible).toBe(false)
  })

  it('rejects generated JavaScript that does not parse', () => {
    const result = qualifyGeneratedApplication(withFile('app.js', 'function broken( {'), contract)
    expect(result.checks.find((check) => check.id === 'javascript')).toMatchObject({ passed: false, hardFailure: true })
    expect(result.eligible).toBe(false)
  })

  it('rejects an unsupported HighLevel bridge operation as a soft deduction', () => {
    const result = qualifyGeneratedApplication(
      withFile('app.js', 'const loading = true; const error = null; const empty = []; window.genesis.highlevel.invoices.list({})'),
      contract,
    )
    const highLevel = result.checks.find((check) => check.id === 'highlevel-contracts')
    expect(highLevel).toMatchObject({ passed: false, hardFailure: false })
    expect(highLevel?.evidence.join(' ')).toContain('invoices.list')
    expect(result.eligible).toBe(true)
    expect(result.deterministicScore).toBeLessThan(100)
  })

  it('records missing required-feature evidence without a hard failure', () => {
    const result = qualifyGeneratedApplication(qualified, {
      ...contract,
      requiredFeatures: ['Appointment rescheduling'],
    })
    const features = result.checks.find((check) => check.id === 'features')
    expect(features).toMatchObject({ passed: false, hardFailure: false })
    expect(features?.evidence.join(' ')).toContain('Appointment rescheduling')
    expect(result.eligible).toBe(true)
  })

  it('rejects an application whose schema no longer holds', () => {
    const result = qualifyGeneratedApplication({ summary: '', files: [] } as never, contract)
    expect(result.checks.find((check) => check.id === 'schema')).toMatchObject({ passed: false, hardFailure: true })
    expect(result.eligible).toBe(false)
    expect(result.deterministicScore).toBe(0)
  })
})
