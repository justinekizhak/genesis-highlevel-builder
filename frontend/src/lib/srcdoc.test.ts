import { describe, expect, it } from 'vitest'
import { buildSrcdoc } from './srcdoc'

describe('buildSrcdoc', () => {
  it('assembles the fixed runtime and limits CDN scripts to the supported runtime host', () => {
    const result = buildSrcdoc({
      'index.html': { path: 'index.html', content: '<main>Hello</main>', language: 'html' },
      'styles.css': { path: 'styles.css', content: 'main{color:red}', language: 'css' },
      'app.js': { path: 'app.js', content: 'console.log("ready")', language: 'javascript' },
    })
    expect(result).toContain("connect-src https://cdn.jsdelivr.net")
    expect(result).toContain("script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net")
    expect(result).toContain('<main>Hello</main>')
    expect(result).toContain('console.log("ready")')
    expect(result).not.toContain('genesis.highlevel.v1')
  })

  it('injects only the allowlisted HighLevel bridge when enabled', () => {
    const result = buildSrcdoc({
      'index.html': { path: 'index.html', content: '<main>Hello</main>', language: 'html' },
      'app.js': { path: 'app.js', content: '', language: 'javascript' },
    }, { enableHighLevelBridge: true })
    expect(result).toContain('genesis.highlevel.v1')
    expect(result).toContain("invoke('contacts.list'")
    expect(result).toContain("invoke('contacts.create'")
    expect(result).toContain("invoke('contacts.update'")
    expect(result).toContain("invoke('conversations.send'")
    expect(result).toContain("invoke('calendars.availability'")
    expect(result).toContain("invoke('appointments.list'")
    expect(result).toContain("event.source !== window.parent")
  })
})
