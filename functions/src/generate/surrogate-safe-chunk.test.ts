import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { chunkSurrogateSafe, safeGrowingPrefixEnd } from './surrogate-safe-chunk.js'

describe('chunkSurrogateSafe', () => {
  it('never splits a surrogate pair across two chunks, at any chunk size', () => {
    const content = `console.log("Nice job! ${'\u{1F389}'.repeat(5)}")`
    for (let chunkSize = 1; chunkSize <= content.length + 2; chunkSize += 1) {
      const chunks = chunkSurrogateSafe(content, chunkSize)
      expect(chunks.join('')).toBe(content)
      for (const chunk of chunks) {
        // Encoding each chunk to UTF-8 independently must round-trip losslessly — a split
        // surrogate pair would produce a lone half that UTF-8 cannot represent and silently
        // replaces with U+FFFD, which is exactly what corrupted the checksum in production.
        expect(Buffer.from(chunk, 'utf8').toString('utf8')).toBe(chunk)
      }
    }
  })

  it('produces chunks whose concatenated hash matches the original content hash', () => {
    const content = 'Welcome \u{1F44B} to the dashboard → click through'
    const chunks = chunkSurrogateSafe(content, 4)
    const reassembled = chunks.map((chunk) => Buffer.from(chunk, 'utf8')).join('')
    expect(createHash('sha256').update(reassembled).digest('hex'))
      .toBe(createHash('sha256').update(content, 'utf8').digest('hex'))
  })
})

describe('safeGrowingPrefixEnd', () => {
  it('holds back a trailing lone high surrogate until its pair arrives', () => {
    const emoji = '\u{1F389}'
    const prefix = `hello ${emoji[0]}`
    expect(safeGrowingPrefixEnd(prefix, 0)).toBe(prefix.length - 1)
  })

  it('allows the full prefix once the pair is complete', () => {
    const content = `hello ${'\u{1F389}'}`
    expect(safeGrowingPrefixEnd(content, 0)).toBe(content.length)
  })

  it('never returns less than `from`', () => {
    expect(safeGrowingPrefixEnd('abc', 3)).toBe(3)
  })
})
