import { diffLines } from 'diff'

export type LineEdit = {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  text: string
}

/**
 * Turns a before/after pair into the minimal set of line replacements that gets from one to the
 * other. The generator re-streams a whole file when it edits one, so applying the result verbatim
 * would blank and retype the document; these operations leave untouched lines alone, which keeps
 * the scroll position, folding, selection and undo history intact.
 *
 * Ranges are expressed in `before`'s coordinate space, as Monaco's pushEditOperations expects.
 */
export function lineEditOperations(before: string, after: string): LineEdit[] {
  if (before === after) return []

  const lineCount = before.split('\n').length
  const lastLineLength = before.length - (before.lastIndexOf('\n') + 1)

  const edits: LineEdit[] = []
  let line = 1
  let pendingStart = 1
  let pendingRemoved = 0
  let pendingAdded = ''
  let hasPending = false

  function flush() {
    if (!hasPending) return
    const endLine = pendingStart + pendingRemoved
    const range: LineEdit['range'] = endLine <= lineCount
      ? { startLineNumber: pendingStart, startColumn: 1, endLineNumber: endLine, endColumn: 1 }
      // The hunk runs through the final line, which has no following line to anchor the end on, so
      // it ends at end-of-document instead. The replacement text keeps its own trailing newline:
      // there is none after the last line to absorb it.
      : {
        startLineNumber: pendingStart,
        startColumn: 1,
        endLineNumber: lineCount,
        endColumn: lastLineLength + 1,
      }
    edits.push({ range, text: pendingAdded })
    hasPending = false
    pendingRemoved = 0
    pendingAdded = ''
  }

  for (const part of diffLines(before, after)) {
    const count = part.count ?? 0
    if (part.added) {
      if (!hasPending) {
        pendingStart = line
        hasPending = true
      }
      pendingAdded += part.value
      continue
    }
    if (part.removed) {
      if (!hasPending) {
        pendingStart = line
        hasPending = true
      }
      pendingRemoved += count
      line += count
      continue
    }
    flush()
    line += count
  }
  flush()

  return edits
}

/** 1-indexed line of the first change, for scrolling the edit into view. */
export function firstEditedLine(edits: LineEdit[]) {
  return edits.length ? edits[0]!.range.startLineNumber : undefined
}

/** 1-indexed line where the last change ends — the point the text is currently being written at. */
export function lastEditedLine(edits: LineEdit[]) {
  const edit = edits[edits.length - 1]
  if (!edit) return undefined
  let newlines = 0
  for (let i = 0; i < edit.text.length; i += 1) if (edit.text.charCodeAt(i) === 10) newlines += 1
  return edit.range.startLineNumber + newlines
}

/**
 * What the document should look like part-way through a re-stream.
 *
 * The generator re-emits a whole file to edit it, so at any moment we hold a prefix of the new
 * content and the untouched original. Lines of the original past the point the stream has reached
 * have not been deleted — they simply have not been re-emitted yet — so a trailing run of removals
 * is treated as "not reached" and kept, letting the rest of the file sit still while the written
 * region updates. Only whole lines are considered, so a half-written line never flickers on screen.
 */
export function streamingContent(before: string, partial: string) {
  const lastNewline = partial.lastIndexOf('\n')
  if (lastNewline === -1) return before
  const settledPartial = partial.slice(0, lastNewline + 1)

  const parts = diffLines(before, settledPartial)

  // Removals that run to the end of `before` are the not-yet-reached tail. They are not necessarily
  // the last part: when the stream's frontier is itself an edit, the diff reports the removals and
  // then the replacement line after them, so anchor on the last part that consumes `before` instead.
  let lastConsuming = -1
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!parts[i]!.added) {
      lastConsuming = i
      break
    }
  }

  let written = ''
  let notReached = ''
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!
    if (part.added) {
      written += part.value
    } else if (part.removed) {
      if (i === lastConsuming) notReached = part.value
    } else {
      written += part.value
    }
  }

  return written + notReached
}
