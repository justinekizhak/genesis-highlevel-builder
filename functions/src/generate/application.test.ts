import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildApplicationEvents, buildFinalistFileEvents, generatedApplicationSchema } from './application.js'

const valid = {
  summary: 'Built the requested dashboard.',
  files: [
    { path: 'index.html', content: '<main>Hello</main>' },
    { path: 'styles.css', content: 'main { color: red; }' },
    { path: 'app.js', content: 'console.log("ready")' },
  ],
}

describe('generated application boundary', () => {
  it('accepts the three preview files and creates semantic events', () => {
    const application = generatedApplicationSchema.parse(valid)
    const { events } = buildApplicationEvents(application, 5)
    expect(events[0]?.type).toBe('generation_started')
    expect(events.some((event) => event.type === 'snapshot_created')).toBe(true)
    expect(events.at(-1)?.type).toBe('complete')
  })

  it('rejects duplicate or unsafe file paths', () => {
    const unsafe = { ...valid, files: valid.files.map((file) => ({ ...file })) }
    unsafe.files[0]!.path = '../index.html'
    expect(generatedApplicationSchema.safeParse(unsafe).success).toBe(false)

    const duplicate = { ...valid, files: valid.files.map((file) => ({ ...file })) }
    duplicate.files[2]!.path = 'index.html'
    expect(generatedApplicationSchema.safeParse(duplicate).success).toBe(false)
  })

  it('never splits a surrogate pair across chunk boundaries, keeping the checksum reproducible', () => {
    // A chunk size that lands exactly inside the emoji's surrogate pair used to send one delta
    // ending in a lone high surrogate and the next starting with the lone low surrogate — each
    // gets UTF-8 encoded independently for its own SSE frame, which mangles the lone half into
    // U+FFFD and breaks the sha256 check on the client even though the sizes still line up.
    const content = 'console.log("Nice job! \u{1F389}")'
    const withEmoji = { ...valid, files: valid.files.map((file) => file.path === 'app.js' ? { ...file, content } : { ...file }) }
    const application = generatedApplicationSchema.parse(withEmoji)
    const chunkSizeSplittingThePair = content.indexOf('\u{1F389}') + 1
    const { events } = buildApplicationEvents(application, chunkSizeSplittingThePair)

    const deltas = events.filter((event) => event.type === 'file_delta' && event.path === 'app.js')
    for (const event of deltas) {
      const delta = event.type === 'file_delta' ? event.delta : ''
      expect(Buffer.from(delta, 'utf8').toString('utf8')).toBe(delta)
    }
    const rebuilt = deltas.map((event) => event.type === 'file_delta' ? event.delta : '').join('')
    expect(rebuilt).toBe(content)

    const complete = events.find((event) => event.type === 'file_complete' && event.path === 'app.js')
    expect(complete && complete.type === 'file_complete' ? complete.sha256 : undefined)
      .toBe(createHash('sha256').update(content).digest('hex'))
  })
})

describe('finalist file transfer', () => {
  it('never splits a surrogate pair across chunk boundaries', () => {
    const content = 'const label = "Nice job! \u{1F389}"'
    const chunkSizeSplittingThePair = content.indexOf('\u{1F389}') + 1
    const events = buildFinalistFileEvents('candidate-1', { 'app.js': content }, chunkSizeSplittingThePair)

    const deltas = events.filter((event) => event.type === 'finalist_file_delta')
    const rebuilt = deltas.map((event) => event.type === 'finalist_file_delta' ? event.delta : '').join('')
    expect(rebuilt).toBe(content)

    const complete = events.find((event) => event.type === 'finalist_file_complete')
    expect(complete && complete.type === 'finalist_file_complete' ? complete.sha256 : undefined)
      .toBe(createHash('sha256').update(content).digest('hex'))
  })
})
