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
    expect(result).toContain('<style data-genesis-theme-guard>')
    expect(result).toContain('--background:#0d0e0d')
    expect(result).toContain('font-family:Geist,"Avenir Next","SF Pro Text"')
    expect(result).toContain('-webkit-font-smoothing:antialiased')
    expect(result).toContain('select{color-scheme:dark;background-color:var(--surface-sunken)}')
    expect(result).not.toContain('genesis.highlevel.v1')
  })

  it('strips stray <link>/<script src> references to the already-inlined files', () => {
    const result = buildSrcdoc({
      'index.html': {
        path: 'index.html',
        content:
          '<link rel="stylesheet" href="styles.css"><div id="app"></div><script src="app.js"></script>',
        language: 'html',
      },
      'styles.css': { path: 'styles.css', content: 'main{color:red}', language: 'css' },
      'app.js': { path: 'app.js', content: 'console.log("ready")', language: 'javascript' },
    })

    expect(result).not.toContain('href="styles.css"')
    expect(result).not.toContain('src="app.js"')
    expect(result).toContain('<div id="app"></div>')
  })

  it('keeps the generated app dark when its token rule is malformed', () => {
    const result = buildSrcdoc({
      'index.html': { path: 'index.html', content: '<main>Hello</main>', language: 'html' },
      'styles.css': {
        path: 'styles.css',
        content: 'color-scheme: dark; :root { --background: #0d0e0d; } body { background: var(--background); }',
        language: 'css',
      },
      'app.js': { path: 'app.js', content: '', language: 'javascript' },
    })

    expect(result).toContain('<style data-genesis-theme-guard>:root{color-scheme:dark;--background:#0d0e0d')
    expect(result.indexOf('data-genesis-theme-guard')).toBeGreaterThan(result.indexOf('color-scheme: dark; :root'))
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
    expect(result).toContain('event.source !== bridgeHost')
    expect(result).toContain('events: Object.freeze({')
    expect(result).toContain("if (data.direction === 'event') { emitEvent(data.event); return; }")
  })

  it('connects a standalone preview through an isolated broadcast channel', () => {
    const result = buildSrcdoc({
      'index.html': { path: 'index.html', content: '<main>Hello</main>', language: 'html' },
      'app.js': { path: 'app.js', content: '', language: 'javascript' },
    }, { enableHighLevelBridge: true, highLevelBridgeChannel: 'genesis-preview-test' })

    expect(result).toContain('const broadcastChannelName = "genesis-preview-test"')
    expect(result).toContain('new BroadcastChannel(broadcastChannelName)')
    expect(result).toContain('broadcast.postMessage(message)')
    expect(result).not.toContain('data is not available when the preview is opened in its own tab')
  })
})
