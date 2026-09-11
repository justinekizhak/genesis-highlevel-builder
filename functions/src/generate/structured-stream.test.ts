import { describe, expect, it } from 'vitest'
import { StructuredApplicationStream } from './structured-stream.js'

const application = JSON.stringify({
  summary: 'Built a useful dashboard.',
  files: [
    { path: 'index.html', content: '<main>"Hello"</main>' },
    { path: 'styles.css', content: 'main { color: red; }' },
    { path: 'app.js', content: 'console.log("ready")\n' },
  ],
})

describe('StructuredApplicationStream', () => {
  it('turns arbitrarily split structured JSON into semantic deltas', () => {
    const parser = new StructuredApplicationStream()
    const events = []
    for (let index = 0; index < application.length; index += 7) {
      events.push(...parser.push(application.slice(index, index + 7)))
    }

    expect(events.filter((event) => event.type === 'token').map((event) => 'delta' in event ? event.delta : '').join(''))
      .toBe('Built a useful dashboard.')
    for (const file of JSON.parse(application).files as Array<{ path: string; content: string }>) {
      const rebuilt = events
        .filter((event) => event.type === 'file_delta' && event.path === file.path)
        .map((event) => event.type === 'file_delta' ? event.delta : '')
        .join('')
      expect(rebuilt).toBe(file.content)
      expect(events.some((event) => event.type === 'file_complete' && event.path === file.path)).toBe(true)
    }
  })

  it('retains the latest partial file text for interrupted generations', () => {
    const parser = new StructuredApplicationStream()
    parser.push('{"summary":"Working","files":[{"path":"index.html","content":"<main>Partial')
    expect(parser.partialFiles()).toEqual({ 'index.html': '<main>Partial' })
  })
})
