import { ref } from 'vue'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useTypewriter() {
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
    revealedLength.value += Math.max(1, Math.ceil(backlog / 6))
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
