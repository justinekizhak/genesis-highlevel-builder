import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTextPacer } from './textPacer'

let callbacks: Map<number, FrameRequestCallback>
let nextFrameId: number
let timestamp: number

function runFrame(elapsed = 1000 / 60) {
  timestamp += elapsed
  const pending = [...callbacks.values()]
  callbacks.clear()
  for (const callback of pending) callback(timestamp)
}

function mockMotionPreference(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })))
}

beforeEach(() => {
  callbacks = new Map()
  nextFrameId = 1
  timestamp = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++
    callbacks.set(id, callback)
    return id
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)))
  mockMotionPreference(false)
})

afterEach(() => vi.unstubAllGlobals())

describe('useTextPacer', () => {
  it('wakes back up when more streamed text arrives after catching up', () => {
    let text = ''
    const pacer = useTextPacer(120)
    pacer.start(() => text)
    runFrame()
    expect(callbacks.size).toBe(0)

    text = 'abcd'
    pacer.wake()
    runFrame()
    expect(pacer.revealedLength.value).toBe(2)
    runFrame()
    expect(pacer.revealedLength.value).toBe(4)
  })

  it('reveals new deltas immediately when reduced motion is requested', () => {
    mockMotionPreference(true)
    let text = ''
    const pacer = useTextPacer()
    pacer.start(() => text)

    text = 'new content'
    pacer.wake()
    expect(pacer.revealedLength.value).toBe(text.length)
    expect(callbacks.size).toBe(0)
  })

  it('paces by elapsed time instead of display frame count', () => {
    let text = 'x'.repeat(200)
    const pacer = useTextPacer(100)
    pacer.start(() => text)

    runFrame(1000 / 60)
    for (let index = 0; index < 10; index += 1) runFrame(10)
    expect(pacer.revealedLength.value).toBe(11)
  })

  it('does not split a surrogate pair while revealing text', () => {
    const pacer = useTextPacer(60)
    pacer.start(() => '🚀 launch')
    runFrame()
    expect(pacer.revealedLength.value).toBe(2)
    expect('🚀 launch'.slice(0, pacer.revealedLength.value)).toBe('🚀')
  })

  it('finish reveals the current source and cancels further work', () => {
    let text = 'partial'
    const pacer = useTextPacer()
    pacer.start(() => text)
    pacer.finish()
    expect(pacer.revealedLength.value).toBe(text.length)
    expect(callbacks.size).toBe(0)

    text += ' ignored'
    pacer.wake()
    expect(pacer.revealedLength.value).toBe('partial'.length)
  })
})
