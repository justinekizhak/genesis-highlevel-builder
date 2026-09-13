import { diffLines } from 'diff'

type DiffStep = { kind: 'context' | 'removed' | 'added'; text: string }

function avoidSplittingSurrogatePair(text: string, end: number) {
  if (end <= 0 || end >= text.length) return end
  const previous = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  return previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF ? end + 1 : end
}

/**
 * Drives a refinement's editor content from `before` to `after` one animation tick at a time,
 * so unchanged lines never move and only the actually-changed hunks visibly type in. Unlike a
 * flat character reveal (which requires clearing the file first), this keeps the untouched parts
 * of `before` on screen throughout and only touches the regions the diff says changed.
 */
export function createDiffReveal(before: string, after: string) {
  const steps: DiffStep[] = diffLines(before, after).map((part) => ({
    kind: part.added ? 'added' : part.removed ? 'removed' : 'context',
    text: part.value,
  }))
  const addedTotal = steps.reduce((sum, step) => sum + (step.kind === 'added' ? step.text.length : 0), 0)

  let stepIndex = 0
  let addedOffset = 0
  let prefix = ''
  let remainder = before

  function isDone() {
    return stepIndex >= steps.length
  }

  /** 1-indexed {line, column} of the current reveal cursor, so the editor can plant a real caret there and follow it. */
  function currentPosition() {
    let line = 1
    let column = 1
    for (let i = 0; i < prefix.length; i += 1) {
      if (prefix.charCodeAt(i) === 10) {
        line += 1
        column = 1
      } else {
        column += 1
      }
    }
    return { line, column }
  }

  /** Advances by up to `addedCharBudget` newly-revealed added characters; free steps cost nothing. */
  function tick(addedCharBudget: number): string {
    let budget = addedCharBudget
    while (stepIndex < steps.length) {
      const step = steps[stepIndex]!
      if (step.kind === 'context') {
        prefix += step.text
        remainder = remainder.slice(step.text.length)
        stepIndex += 1
        continue
      }
      if (step.kind === 'removed') {
        remainder = remainder.slice(step.text.length)
        stepIndex += 1
        continue
      }
      if (budget <= 0) break
      const remainingInStep = step.text.length - addedOffset
      const take = avoidSplittingSurrogatePair(step.text, addedOffset + Math.min(remainingInStep, budget)) - addedOffset
      prefix += step.text.slice(addedOffset, addedOffset + take)
      addedOffset += take
      budget -= take
      if (addedOffset >= step.text.length) {
        addedOffset = 0
        stepIndex += 1
      } else {
        break
      }
    }
    return prefix + remainder
  }

  return { tick, isDone, addedTotal, finalText: after, currentPosition }
}
