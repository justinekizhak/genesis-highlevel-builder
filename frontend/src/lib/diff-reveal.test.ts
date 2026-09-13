import { describe, expect, it } from 'vitest'
import { createDiffReveal } from './diff-reveal'

describe('createDiffReveal', () => {
  it('resolves to the unchanged text with no added characters', () => {
    const reveal = createDiffReveal('same', 'same')
    expect(reveal.addedTotal).toBe(0)
    expect(reveal.tick(10)).toBe('same')
    expect(reveal.isDone()).toBe(true)
  })

  it('reveals a pure addition progressively, like typing from empty', () => {
    const reveal = createDiffReveal('', 'hello')
    expect(reveal.tick(2)).toBe('he')
    expect(reveal.isDone()).toBe(false)
    expect(reveal.tick(3)).toBe('hello')
    expect(reveal.isDone()).toBe(true)
  })

  it('keeps unchanged context in place and only animates the changed line', () => {
    const before = 'line1\nline2\nline3'
    const after = 'line1\nCHANGED\nline3'
    const reveal = createDiffReveal(before, after)

    // First tick with zero added-budget still processes the free context/removed steps:
    // line1 stays, line2 disappears, and "line3" (still un-typed "CHANGED") trails right after.
    const firstFrame = reveal.tick(0)
    expect(firstFrame.startsWith('line1\n')).toBe(true)
    expect(firstFrame).not.toContain('line2')
    expect(firstFrame.endsWith('line3')).toBe(true)

    while (!reveal.isDone()) reveal.tick(3)
    expect(reveal.tick(0)).toBe(after)
  })

  it('drops a removed trailing hunk without animating it', () => {
    const reveal = createDiffReveal('keep\nremoved-tail', 'keep')
    while (!reveal.isDone()) reveal.tick(3)
    expect(reveal.tick(0)).toBe('keep')
  })

  it('reports the total number of added characters to pace the animation', () => {
    const reveal = createDiffReveal('line1\nline2', 'line1\nCHANGED')
    expect(reveal.addedTotal).toBe('CHANGED'.length)
  })

  it('never reveals half of a UTF-16 surrogate pair', () => {
    const reveal = createDiffReveal('', '🚀 launch')
    expect(reveal.tick(1)).toBe('🚀')
    expect(reveal.tick(1)).toBe('🚀 ')
  })
})
