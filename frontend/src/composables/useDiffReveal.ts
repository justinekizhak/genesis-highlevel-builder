import { createDiffReveal } from '@/lib/diff-reveal'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const INITIAL_FRAME_MS = 1000 / 60
const MAX_ELAPSED_MS = 100
const MIN_CHARS_PER_SECOND = 120
const MAX_CHARS_PER_SECOND = 2400
const TARGET_DURATION_MS = 300

/** Mirrors useTypewriter's start/finish shape, but reveals a before->after diff in place. */
export function useDiffReveal() {
  let frame: number | undefined
  let finalText: string | undefined
  let frameHandler: ((text: string) => void) | undefined

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  function finish() {
    stop()
    if (finalText !== undefined && frameHandler) frameHandler(finalText)
    finalText = undefined
    frameHandler = undefined
  }

  function start(before: string, after: string, onFrame: (text: string) => void) {
    stop()
    const reveal = createDiffReveal(before, after)
    finalText = after
    frameHandler = onFrame
    if (!motionAllowed()) {
      finish()
      return
    }
    const rate = Math.max(
      MIN_CHARS_PER_SECOND,
      Math.min(MAX_CHARS_PER_SECOND, reveal.addedTotal * 1000 / TARGET_DURATION_MS),
    )
    let previousTimestamp: number | undefined
    let fractionalCharacters = 0
    function tick(timestamp: number) {
      frame = undefined
      if (!motionAllowed()) {
        finish()
        return
      }
      const elapsed = previousTimestamp === undefined
        ? INITIAL_FRAME_MS
        : Math.min(MAX_ELAPSED_MS, Math.max(0, timestamp - previousTimestamp))
      previousTimestamp = timestamp
      fractionalCharacters += rate * elapsed / 1000
      const step = Math.floor(fractionalCharacters)
      if (step > 0) {
        onFrame(reveal.tick(step))
        fractionalCharacters = Math.max(0, fractionalCharacters - step)
      }
      if (!reveal.isDone()) frame = requestAnimationFrame(tick)
      else {
        finalText = undefined
        frameHandler = undefined
      }
    }
    frame = requestAnimationFrame(tick)
  }

  return { start, stop, finish }
}
