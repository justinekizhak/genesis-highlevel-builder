import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateWithOpenAi } from './openai.js'

const application = {
  summary: 'Built a contact dashboard.',
  files: [
    { path: 'index.html' as const, content: '<main>Contacts</main>' },
    { path: 'styles.css' as const, content: 'main { padding: 1rem; }' },
    { path: 'app.js' as const, content: 'console.log("ready")' },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
})

describe('OpenAI streaming transport', () => {
  it('collects output-text deltas while exposing them incrementally', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const json = JSON.stringify(application)
    const frames = [json.slice(0, 35), json.slice(35, 97), json.slice(97)]
      .map((delta, sequence) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta, sequence_number: sequence })}\n\n`)
      .join('')
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(frames.slice(0, 113)))
        controller.enqueue(encoder.encode(frames.slice(113)))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    const deltas: string[] = []

    await expect(generateWithOpenAi('Build contacts', {}, undefined, (delta) => deltas.push(delta)))
      .resolves.toEqual(application)
    expect(deltas.join('')).toBe(json)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.body).toContain('"stream":true')
  })
})
