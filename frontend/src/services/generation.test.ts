import { describe, expect, it, vi } from 'vitest'
import { consumeGenerationStream, generateApplication, parseSseBlock } from './generation'
import type { GenerationEvent } from '@/types/generation'

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }))
}

describe('generation SSE transport', () => {
  it('parses data frames and ignores heartbeat comments', () => {
    expect(parseSseBlock(': heartbeat')).toBeUndefined()
    expect(parseSseBlock('event: token\ndata: {"type":"token","delta":"Hi"}')).toEqual({ type: 'token', delta: 'Hi' })
  })

  it('handles frames split across transport chunks', async () => {
    const events: GenerationEvent[] = []
    await consumeGenerationStream(streamResponse([
      'event: token\ndata: {"type":"token",',
      '"delta":"Hello"}\n\n: heartbeat\n\n',
      'event: complete\ndata: {"type":"complete","generationId":"g1"}\n\n',
    ]), (event) => events.push(event))
    expect(events).toEqual([
      { type: 'token', delta: 'Hello' },
      { type: 'complete', generationId: 'g1' },
    ])
  })

  it('rejects a connection that closes without a terminal event', async () => {
    await expect(consumeGenerationStream(streamResponse([
      'event: file_start\ndata: {"type":"file_start","path":"index.html","language":"html"}\n\n',
    ]), () => undefined)).rejects.toThrow('ended before completion')
  })
})

describe('generateApplication', () => {
  it('retries a temporary project lock and then consumes the generation', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'http://127.0.0.1:5001/jk-ai-app-builder/us-central1')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'locked' }), { status: 409 }))
      .mockResolvedValueOnce(streamResponse([
        'event: complete\ndata: {"type":"complete","generationId":"g1"}\n\n',
      ]))
    vi.stubGlobal('fetch', fetchMock)
    const events: GenerationEvent[] = []

    await generateApplication({
      prompt: 'Build a dashboard',
      projectId: 'project-1',
      generationId: '13f4f45c-4fc1-4fc9-89bc-29f712340eb2',
      model: 'gpt-5.4',
      currentFiles: {},
      idToken: 'token',
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      body: expect.stringContaining('"model":"gpt-5.4"'),
    }))
    expect(events).toEqual([{ type: 'complete', generationId: 'g1' }])
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
