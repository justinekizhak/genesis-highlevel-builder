import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError } from 'openai'
import { buildModelInput, generateWithOpenAi } from './openai.js'

const application = {
  summary: 'Built a contact dashboard.',
  files: [
    { path: 'index.html' as const, content: '<main>Contacts</main>' },
    { path: 'styles.css' as const, content: 'main { padding: 1rem; }' },
    { path: 'app.js' as const, content: 'console.log("ready")' },
  ],
}

const createMock = vi.fn()

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai')
  return {
    ...actual,
    default: class FakeOpenAI {
      responses = { create: createMock }
    },
  }
})

async function* eventsOf(events: Array<Record<string, unknown>>) {
  for (const event of events) yield event
}

function deltaEvents(text: string, chunkSize: number) {
  const chunks: Array<Record<string, unknown>> = []
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push({ type: 'response.output_text.delta', delta: text.slice(index, index + chunkSize) })
  }
  return chunks
}

afterEach(() => {
  createMock.mockReset()
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
    createMock.mockResolvedValue(eventsOf(deltaEvents(json, 35)))
    const deltas: string[] = []

    await expect(generateWithOpenAi('Build contacts', {}, undefined, (delta) => deltas.push(delta)))
      .resolves.toEqual(application)
    expect(deltas.join('')).toBe(json)
    const requestBody = createMock.mock.calls[0]?.[0]
    expect(requestBody.stream).toBe(true)
    expect(requestBody.instructions).toContain('interpret contacts,\nconversations, and calendars as HighLevel contacts')
    expect(requestBody.instructions).toContain('window.genesis.highlevel.contacts.list(parameters)')
  })

  it('never asks the model to reach for Tailwind or another CSS framework', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    createMock.mockResolvedValue(eventsOf([]))
    await generateWithOpenAi('Build contacts', {}).catch(() => {})
    const requestBody = createMock.mock.calls[0]?.[0]
    expect(requestBody.instructions).not.toContain('@tailwindcss/browser')
    expect(requestBody.instructions).toContain('do not add Tailwind')
    expect(requestBody.instructions).toContain('--accent: #e8bd62')
    expect(requestBody.instructions).toContain('Load more')
  })

  it('explains how to recover when OpenAI rejects the configured key', async () => {
    process.env.OPENAI_API_KEY = 'expired-key'
    createMock.mockRejectedValue(new APIError(401, { message: 'Incorrect API key provided.' }, 'Incorrect API key provided.', new Headers()))

    await expect(generateWithOpenAi('Build contacts', {})).rejects.toThrow(
      'OpenAI rejected OPENAI_API_KEY (401)',
    )
  })

  it('shows a friendly message instead of raw billing text when OpenAI is out of quota', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    createMock.mockRejectedValue(new APIError(
      429,
      { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' },
      'You exceeded your current quota, please check your plan and billing details.',
      new Headers(),
    ))

    await expect(generateWithOpenAi('Build contacts', {})).rejects.toThrow(
      "Genesis's AI generation capacity is temporarily exhausted",
    )
  })

  it('surfaces a stream-level failure event as a friendly error', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    createMock.mockResolvedValue(eventsOf([
      { type: 'response.output_text.delta', delta: '{"partial":' },
      { type: 'error', code: 'server_error', message: 'The model overloaded while streaming.', param: null, sequence_number: 1 },
    ]))

    await expect(generateWithOpenAi('Build contacts', {})).rejects.toThrow(
      'The model overloaded while streaming.',
    )
  })
})
