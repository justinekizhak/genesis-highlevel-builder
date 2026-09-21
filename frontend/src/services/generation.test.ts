import { describe, expect, it, vi } from 'vitest'
import {
  consumeGenerationStream,
  generateApplication,
  loadVariationSet,
  parseSseBlock,
  selectVariationFinalist,
} from './generation'
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
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/apiV1/v1/projects/project-1/generations'), expect.objectContaining({
      body: expect.stringContaining('"model":"gpt-5.4"'),
    }))
    expect(events).toEqual([{ type: 'complete', generationId: 'g1' }])
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})

describe('variation transport', () => {
  it('treats variation_complete as terminal', async () => {
    await expect(consumeGenerationStream(streamResponse([
      'event: variation_complete\ndata: {"type":"variation_complete","variationSetId":"set-1"}\n\n',
    ]), vi.fn())).resolves.toBeUndefined()
  })

  it('parses multi-variant blocks across arbitrary chunk boundaries', async () => {
    const events: GenerationEvent[] = []
    await consumeGenerationStream(streamResponse([
      'event: candidate_progress\ndata: {"type":"candidate_pro',
      'gress","candidateId":"a","phase":"styles"}\n\n: heartbeat\n\n',
      'event: variation_complete\ndata: {"type":"variation_complete","variationSetId":"set-1"}\n\n',
    ]), (event) => events.push(event))
    expect(events).toEqual([
      { type: 'candidate_progress', candidateId: 'a', phase: 'styles' },
      { type: 'variation_complete', variationSetId: 'set-1' },
    ])
  })

  it('still rejects a variation stream that closes before any terminal event', async () => {
    await expect(consumeGenerationStream(streamResponse([
      'event: finalists_ready\ndata: {"type":"finalists_ready","variationSetId":"set-1"}\n\n',
    ]), () => undefined)).rejects.toThrow('ended before completion')
  })
})

describe('variation REST calls', () => {
  it('selects a finalist through the owner API', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'http://127.0.0.1:5001/jk-ai-app-builder/us-central1')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ snapshotId: 's1', files: {} })))
    vi.stubGlobal('fetch', fetchMock)

    await selectVariationFinalist('p1', 'set-1', 'candidate-a', 'token')

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/variation-sets/set-1/selection'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ candidateId: 'candidate-a' }),
    }))
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reloads a persisted variation set', async () => {
    vi.stubEnv('VITE_FUNCTIONS_BASE_URL', 'http://127.0.0.1:5001/jk-ai-app-builder/us-central1')
    const payload = { variationSetId: 'set-1', status: 'ready', finalists: [] }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadVariationSet('p1', 'set-1', 'token')).resolves.toMatchObject({ variationSetId: 'set-1' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/projects/p1/variation-sets/set-1'), expect.anything())
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('refuses variation calls without a signed-in token', async () => {
    await expect(loadVariationSet('p1', 'set-1')).rejects.toThrow('Sign in again')
    await expect(selectVariationFinalist('p1', 'set-1', 'candidate-a')).rejects.toThrow('Sign in again')
  })
})
