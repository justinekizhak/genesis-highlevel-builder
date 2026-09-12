import { describe, expect, it } from 'vitest'
import { findUnsafePatterns, UnsafeGenerationError, validateGeneratedApplication } from './validate.js'

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
