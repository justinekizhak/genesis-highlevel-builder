import { createHash } from 'node:crypto'
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

  it('never emits a file_delta ending in a lone surrogate half, even when the source is split mid-emoji', () => {
    // JSON.stringify emits printable characters like emoji literally (as their real surrogate
    // pair), not as \u escapes. Splitting the raw source between those two surrogate halves used
    // to make push() emit a file_delta whose decoded value ended in the lone high surrogate —
    // that delta gets UTF-8 encoded on its own for its SSE frame, which silently mangles the
    // lone surrogate into U+FFFD and breaks the client's checksum check even though sizes match.
    const withEmoji = JSON.stringify({
      summary: 'Done',
      files: [
        { path: 'index.html', content: '<main></main>' },
        { path: 'styles.css', content: 'main {}' },
        { path: 'app.js', content: 'console.log("Nice job! \u{1F389}")' },
      ],
    })
    const emojiIndex = withEmoji.indexOf('\u{1F389}'[0])
    expect(emojiIndex).toBeGreaterThan(0)
    const splitPoint = emojiIndex + 1

    const parser = new StructuredApplicationStream()
    const events = [
      ...parser.push(withEmoji.slice(0, splitPoint)),
      ...parser.push(withEmoji.slice(splitPoint)),
    ]

    for (const event of events) {
      if (event.type !== 'file_delta') continue
      const last = event.delta.charCodeAt(event.delta.length - 1)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }

    const rebuilt = events
      .filter((event) => event.type === 'file_delta' && event.path === 'app.js')
      .map((event) => event.type === 'file_delta' ? event.delta : '')
      .join('')
    expect(rebuilt).toBe('console.log("Nice job! \u{1F389}")')

    const complete = events.find((event) => event.type === 'file_complete' && event.path === 'app.js')
    expect(complete && complete.type === 'file_complete' ? complete.sha256 : undefined)
      .toBe(createHash('sha256').update(rebuilt).digest('hex'))
  })
})
