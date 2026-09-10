import { describe, expect, it } from 'vitest'
import { buildApplicationEvents, generatedApplicationSchema } from './application.js'

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
})
