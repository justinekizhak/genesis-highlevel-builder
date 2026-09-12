import { ref } from 'vue'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Like useTypewriter, but reveals at a fixed rate instead of a fraction of the backlog per frame.
 * A proportional catch-up flashes large chunks instantly when a big delta arrives (fine for short
 * chat tokens, jarring for multi-line code deltas), so this caps how much can appear per frame.
 */
export function useTextPacer(charsPerFrame = 2) {
  const revealedLength = ref(0)
  let frame: number | undefined
  let targetGetter: (() => number) | undefined

  function tick() {
    frame = undefined
    if (!targetGetter) return
    const target = targetGetter()
    const backlog = target - revealedLength.value
    if (backlog <= 0) {
      revealedLength.value = target
      return
    }
    revealedLength.value += Math.min(backlog, charsPerFrame)
    frame = requestAnimationFrame(tick)
  }

  function start(getTarget: () => number) {
    targetGetter = getTarget
    if (!motionAllowed()) {
      revealedLength.value = getTarget()
      return
    }
    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  function reset() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    targetGetter = undefined
    revealedLength.value = 0
  }

  function finish() {
    if (targetGetter) revealedLength.value = targetGetter()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    targetGetter = undefined
  }

  return { revealedLength, start, reset, finish }
}
