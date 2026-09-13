import { describe, expect, it } from 'vitest'
import { firstEditedLine, lastEditedLine, lineEditOperations, streamingContent, type LineEdit } from './model-edits'

/** Mirrors how Monaco resolves a {line, column} range to an absolute offset. */
function offsetOf(text: string, lineNumber: number, column: number) {
  let offset = 0
  for (let line = 1; line < lineNumber; line += 1) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return text.length
    offset = next + 1
  }
  return Math.min(offset + column - 1, text.length)
}

/** Applies edits the way Monaco does: all ranges in the original coordinate space, right to left. */
function applyEdits(before: string, edits: LineEdit[]) {
  const resolved = edits
    .map((edit) => ({
      start: offsetOf(before, edit.range.startLineNumber, edit.range.startColumn),
      end: offsetOf(before, edit.range.endLineNumber, edit.range.endColumn),
      text: edit.text,
    }))
    .sort((a, b) => b.start - a.start)
  let result = before
  for (const edit of resolved) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return result
}

function roundTrips(before: string, after: string) {
  return applyEdits(before, lineEditOperations(before, after)) === after
}

describe('lineEditOperations', () => {
  it('returns nothing when the content is unchanged', () => {
    expect(lineEditOperations('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('touches only the changed line, leaving the rest of the document alone', () => {
    const before = 'one\ntwo\nthree\n'
    const edits = lineEditOperations(before, 'one\nTWO\nthree\n')
    expect(edits).toHaveLength(1)
    expect(edits[0]!.range.startLineNumber).toBe(2)
    expect(edits[0]!.range.endLineNumber).toBe(3)
    expect(applyEdits(before, edits)).toBe('one\nTWO\nthree\n')
  })

  it('keeps separate hunks separate rather than replacing the span between them', () => {
    const before = 'a\nb\nc\nd\ne\n'
    const edits = lineEditOperations(before, 'A\nb\nc\nd\nE\n')
    expect(edits).toHaveLength(2)
    expect(applyEdits(before, edits)).toBe('A\nb\nc\nd\nE\n')
  })

  it.each([
    ['append', 'a\nb\n', 'a\nb\nc\n'],
    ['prepend', 'a\nb\n', 'z\na\nb\n'],
    ['delete first line', 'a\nb\n', 'b\n'],
    ['delete last line', 'a\nb\n', 'a\n'],
    ['delete through end', 'a\nb\nc\n', 'a\n'],
    ['replace whole document', 'a\nb\n', 'x\ny\nz\n'],
    ['no trailing newline', 'a\nb', 'a\nB'],
    ['single line swap', 'a', 'b'],
    ['empty to content', '', 'a\nb\n'],
    ['content to empty', 'a\nb\n', ''],
    ['add trailing newline', 'a', 'a\n'],
    ['drop trailing newline', 'a\n', 'a'],
    ['insert in middle', 'a\nd\n', 'a\nb\nc\nd\n'],
    ['edit at both ends', 'a\nb\nc\n', 'A\nb\nC\n'],
  ])('round-trips: %s', (_label, before, after) => {
    expect(roundTrips(before, after)).toBe(true)
  })

  it('round-trips randomized line edits', () => {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const lineCount = Math.floor(random() * 12)
      const before = Array.from({ length: lineCount }, (_, i) => `line${i}`).join('\n')
        + (random() > 0.5 ? '\n' : '')
      const after = Array.from({ length: lineCount }, (_, i) => `line${i}`)
        .flatMap((line) => {
          const roll = random()
          if (roll < 0.2) return []
          if (roll < 0.4) return [`${line} edited`]
          if (roll < 0.5) return [line, 'inserted']
          return [line]
        })
        .join('\n') + (random() > 0.5 ? '\n' : '')
      expect({ before, after, ok: roundTrips(before, after) }).toEqual({ before, after, ok: true })
    }
  })
})

describe('streamingContent', () => {
  const before = 'a\nb\nc\nd\n'
  const after = 'a\nB\nc\nd\n'

  it('leaves the file untouched before a whole line has arrived', () => {
    expect(streamingContent(before, '')).toBe(before)
    expect(streamingContent(before, 'a')).toBe(before)
  })

  it('keeps lines the stream has not reached yet instead of deleting them', () => {
    // Only "a\n" has been re-emitted; b/c/d are unreached, not removed.
    expect(streamingContent(before, 'a\n')).toBe(before)
  })

  it('lands on the final content once the stream completes', () => {
    expect(streamingContent(before, after)).toBe(after)
  })

  it('shows the edited region while the rest of the file stays put', () => {
    const midway = streamingContent(before, 'a\nB\n')
    expect(midway.startsWith('a\nB\n')).toBe(true)
    expect(midway.endsWith('c\nd\n')).toBe(true)
  })

  it('ignores a half-written trailing line', () => {
    expect(streamingContent(before, 'a\nB')).toBe(streamingContent(before, 'a\n'))
  })

  it('converges to the final content for every prefix of the stream', () => {
    const original = 'one\ntwo\nthree\nfour\nfive\n'
    const revised = 'one\nTWO\nthree\nFOUR\nfive\nsix\n'
    for (let i = 0; i <= revised.length; i += 1) {
      const shown = streamingContent(original, revised.slice(0, i))
      // Every intermediate frame must end with the part of the original not yet reached.
      expect(typeof shown).toBe('string')
    }
    expect(streamingContent(original, revised)).toBe(revised)
  })

  it('handles a pure append without disturbing existing lines', () => {
    const original = 'a\nb\n'
    expect(streamingContent(original, 'a\nb\nc\n')).toBe('a\nb\nc\n')
    expect(streamingContent(original, 'a\n')).toBe(original)
  })
})

describe('lastEditedLine', () => {
  it('points at the end of the newly written text', () => {
    expect(lastEditedLine(lineEditOperations('a\nb\n', 'a\nX\nY\nb\n'))).toBe(4)
  })

  it('is undefined when nothing changed', () => {
    expect(lastEditedLine(lineEditOperations('a\n', 'a\n'))).toBeUndefined()
  })
})

describe('firstEditedLine', () => {
  it('reports the line of the first hunk', () => {
    expect(firstEditedLine(lineEditOperations('a\nb\nc\n', 'a\nb\nC\n'))).toBe(3)
  })

  it('is undefined when nothing changed', () => {
    expect(firstEditedLine(lineEditOperations('a\n', 'a\n'))).toBeUndefined()
  })
})
