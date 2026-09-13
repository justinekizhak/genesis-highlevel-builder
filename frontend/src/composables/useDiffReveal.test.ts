import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiffReveal } from './useDiffReveal'

let callbacks: Map<number, FrameRequestCallback>
let nextFrameId: number
let timestamp: number

function runFrame(elapsed = 1000 / 60) {
  timestamp += elapsed
  const pending = [...callbacks.values()]
  callbacks.clear()
  for (const callback of pending) callback(timestamp)
}

beforeEach(() => {
  callbacks = new Map()
  nextFrameId = 1
  timestamp = 0
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++
    callbacks.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)))
})

afterEach(() => vi.unstubAllGlobals())

describe('useDiffReveal', () => {
  it('can finish an in-progress reveal synchronously', () => {
    let rendered = ''
    const reveal = useDiffReveal()
    reveal.start('', 'a substantial replacement', (text) => { rendered = text })
    runFrame()
    expect(rendered).not.toBe('a substantial replacement')

    reveal.finish()
    expect(rendered).toBe('a substantial replacement')
    expect(callbacks.size).toBe(0)
  })

  it('uses elapsed time to pace refinement text', () => {
    let rendered = ''
    const reveal = useDiffReveal()
    reveal.start('', 'x'.repeat(200), (text) => { rendered = text })

    runFrame(1000 / 60)
    const afterFirstFrame = rendered.length
    runFrame(100)
    expect(rendered.length - afterFirstFrame).toBeGreaterThan(1)
  })

  it('finishes immediately when reduced motion becomes active', () => {
    let rendered = ''
    const reveal = useDiffReveal()
    reveal.start('', 'replacement', (text) => { rendered = text })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

    runFrame()
    expect(rendered).toBe('replacement')
    expect(callbacks.size).toBe(0)
  })
})
