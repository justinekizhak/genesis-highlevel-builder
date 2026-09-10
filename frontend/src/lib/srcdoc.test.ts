import { describe, expect, it } from 'vitest'
import { buildSrcdoc } from './srcdoc'

describe('buildSrcdoc', () => {
  it('assembles the fixed runtime and blocks network access', () => {
    const result = buildSrcdoc({
      'index.html': { path: 'index.html', content: '<main>Hello</main>', language: 'html' },
      'styles.css': { path: 'styles.css', content: 'main{color:red}', language: 'css' },
      'app.js': { path: 'app.js', content: 'console.log("ready")', language: 'javascript' },
    })
    expect(result).toContain("connect-src 'none'")
    expect(result).toContain('<main>Hello</main>')
    expect(result).toContain('console.log("ready")')
  })
})
