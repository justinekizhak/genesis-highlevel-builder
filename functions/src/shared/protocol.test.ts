import { describe, expect, it } from 'vitest'
import { serializeSse } from './protocol.js'

describe('serializeSse', () => {
  it('formats an SSE frame with an event name and a JSON data line', () => {
    const frame = serializeSse({ type: 'complete', generationId: 'gen-1' })
    expect(frame).toBe('event: complete\ndata: {"type":"complete","generationId":"gen-1"}\n\n')
  })

  it('round-trips through JSON.parse for every event shape', () => {
    const events = [
      { type: 'generation_started' as const, generationId: 'g1' },
      { type: 'token' as const, delta: 'hi' },
      { type: 'file_start' as const, path: 'app.js', language: 'javascript' },
      { type: 'file_delta' as const, path: 'app.js', delta: 'console.log(1)' },
      { type: 'file_complete' as const, path: 'app.js', size: 10, sha256: 'abc' },
      { type: 'snapshot_created' as const, snapshotId: 's1' },
      { type: 'complete' as const, generationId: 'g1' },
      { type: 'error' as const, code: 'X', message: 'bad', recoverable: true },
    ]
    for (const event of events) {
      const frame = serializeSse(event)
      const [eventLine, dataLine] = frame.trimEnd().split('\n')
      expect(eventLine).toBe(`event: ${event.type}`)
      expect(JSON.parse(dataLine!.slice('data: '.length))).toEqual(event)
    }
  })
})
