import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildModelInput, generateWithOpenAi } from './openai.js'

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
  it('includes bounded server-owned project and conversation context', () => {
    const input = buildModelInput('Refine it', { 'app.js': 'stored-file' }, {
      project: { name: 'CRM dashboard', description: 'Current project', locationId: 'location-1' },
      files: { 'app.js': 'stored-file' },
      recentMessages: Array.from({ length: 15 }, (_, index) => ({
        role: index % 2 ? 'assistant' as const : 'user' as const,
        content: `message-${index}`,
      })),
    })
    expect(input).toContain('CRM dashboard')
    expect(input).toContain('stored-file')
    expect(input).not.toContain('message-0')
    expect(input).toContain('message-14')
  })

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
    const requestBody = vi.mocked(fetch).mock.calls[0]?.[1]?.body
    expect(requestBody).toContain('"stream":true')
    expect(requestBody).toContain('interpret contacts,\\nconversations, and calendars as HighLevel contacts')
    expect(requestBody).toContain('window.genesis.highlevel.contacts.list(parameters)')
  })

  it('never asks the model to reach for Tailwind or another CSS framework', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 })))
    await generateWithOpenAi('Build contacts', {}).catch(() => {})
    const requestBody = String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)
    expect(requestBody).not.toContain('@tailwindcss/browser')
    expect(requestBody).toContain('do not add Tailwind')
    expect(requestBody).toContain('--accent: #e8bd62')
    expect(requestBody).toContain('Load more')
  })

  it('explains how to recover when OpenAI rejects the configured key', async () => {
    process.env.OPENAI_API_KEY = 'expired-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Incorrect API key provided.' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })))

    await expect(generateWithOpenAi('Build contacts', {})).rejects.toThrow(
      'OpenAI rejected OPENAI_API_KEY (401)',
    )
  })

  it('shows a friendly message instead of raw billing text when OpenAI is out of quota', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })))

    await expect(generateWithOpenAi('Build contacts', {})).rejects.toThrow(
      "Genesis's AI generation capacity is temporarily exhausted",
    )
  })
})
