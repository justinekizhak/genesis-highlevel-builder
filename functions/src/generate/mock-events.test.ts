import { describe, expect, it } from 'vitest'
import { buildMockEvents } from './mock-events.js'

describe('buildMockEvents', () => {
  it('emits paired file boundaries and terminates cleanly', () => {
    const events = buildMockEvents(24)
    const starts = events.filter((event) => event.type === 'file_start')
    const completes = events.filter((event) => event.type === 'file_complete')

    expect(events[0]?.type).toBe('generation_started')
    expect(starts.map((event) => 'path' in event && event.path)).toEqual(['index.html', 'styles.css', 'app.js'])
    expect(completes).toHaveLength(starts.length)
    expect(events.at(-1)?.type).toBe('complete')
  })

  it('reconstructs every file from deltas', () => {
    const events = buildMockEvents(17)
    const reconstructed = new Map<string, string>()
    for (const event of events) {
      if (event.type === 'file_start') reconstructed.set(event.path, '')
      if (event.type === 'file_delta') reconstructed.set(event.path, (reconstructed.get(event.path) ?? '') + event.delta)
      if (event.type === 'file_complete') expect(reconstructed.get(event.path)?.length).toBe(event.size)
    }
  })
})
