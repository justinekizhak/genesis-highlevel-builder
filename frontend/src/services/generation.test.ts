import { describe, expect, it } from 'vitest'
import { consumeGenerationStream, parseSseBlock } from './generation'
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
