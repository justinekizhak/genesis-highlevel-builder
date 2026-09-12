import { ref } from 'vue'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Extends `length` forward to the end of the word it lands in, so reveals never cut a word in half. */
function extendToWordBoundary(text: string, length: number) {
  if (length >= text.length) return text.length
  const boundary = text.slice(length).search(/\s/)
  return boundary === -1 ? text.length : length + boundary + 1
}

export function useTypewriter() {
  const revealedLength = ref(0)
  let frame: number | undefined
  let textGetter: (() => string) | undefined

  function tick() {
    frame = undefined
    if (!textGetter) return
    const text = textGetter()
    const backlog = text.length - revealedLength.value
    if (backlog <= 0) {
      revealedLength.value = text.length
      return
    }
    const step = Math.max(1, Math.ceil(backlog / 6))
    revealedLength.value = extendToWordBoundary(text, revealedLength.value + step)
    frame = requestAnimationFrame(tick)
  }

  function start(getText: () => string) {
    textGetter = getText
    if (!motionAllowed()) {
      revealedLength.value = getText().length
      return
    }
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  function reset() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    textGetter = undefined
    revealedLength.value = 0
  }

  function finish() {
    if (textGetter) revealedLength.value = textGetter().length
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    textGetter = undefined
  }

  return { revealedLength, start, reset, finish }
}
