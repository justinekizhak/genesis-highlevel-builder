import { ref } from 'vue'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const DEFAULT_CHARS_PER_SECOND = 120
const INITIAL_FRAME_MS = 1000 / 60
const MAX_ELAPSED_MS = 100

function safeSliceLength(text: string, length: number) {
  if (length <= 0 || length >= text.length) return Math.max(0, Math.min(length, text.length))
  const previous = text.charCodeAt(length - 1)
  const next = text.charCodeAt(length)
  const splitsSurrogatePair = previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF
  return splitsSurrogatePair ? length + 1 : length
}

/**
 * Reveals streamed text at a stable, time-based rate. Call `wake` whenever the source grows: the
 * animation intentionally sleeps once it catches up so an idle stream does not consume frames.
 */
export function useTextPacer(charsPerSecond = DEFAULT_CHARS_PER_SECOND) {
  const revealedLength = ref(0)
  let frame: number | undefined
  let textGetter: (() => string) | undefined
  let previousTimestamp: number | undefined
  let fractionalCharacters = 0
  const rate = Number.isFinite(charsPerSecond) && charsPerSecond > 0 ? charsPerSecond : DEFAULT_CHARS_PER_SECOND

  function clearClock() {
    previousTimestamp = undefined
    fractionalCharacters = 0
  }

  function tick(timestamp: number) {
    frame = undefined
    if (!textGetter) return
    const text = textGetter()
    const target = text.length
    if (!motionAllowed()) {
      revealedLength.value = target
      clearClock()
      return
    }
    const backlog = target - revealedLength.value
    if (backlog <= 0) {
      revealedLength.value = target
      clearClock()
      return
    }

    const elapsed = previousTimestamp === undefined
      ? INITIAL_FRAME_MS
      : Math.min(MAX_ELAPSED_MS, Math.max(0, timestamp - previousTimestamp))
    previousTimestamp = timestamp
    fractionalCharacters += rate * elapsed / 1000
    const step = Math.min(backlog, Math.floor(fractionalCharacters))
    if (step > 0) {
      revealedLength.value = safeSliceLength(text, revealedLength.value + step)
      fractionalCharacters = Math.max(0, fractionalCharacters - step)
    }
    frame = requestAnimationFrame(tick)
  }

  function wake() {
    if (!textGetter) return
    if (!motionAllowed()) {
      revealedLength.value = textGetter().length
      clearClock()
      return
    }
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  function start(getText: () => string) {
    textGetter = getText
    wake()
  }

  function reset() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    textGetter = undefined
    clearClock()
    revealedLength.value = 0
  }

  function finish() {
    if (textGetter) revealedLength.value = textGetter().length
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    textGetter = undefined
    clearClock()
  }

  return { revealedLength, start, wake, reset, finish }
}
