import { createDiffReveal } from '@/lib/diff-reveal'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Mirrors useTypewriter's start/finish shape, but reveals a before->after diff in place. */
export function useDiffReveal() {
  let frame: number | undefined

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  function start(before: string, after: string, onFrame: (text: string) => void) {
    stop()
    const reveal = createDiffReveal(before, after)
    if (!motionAllowed()) {
      onFrame(after)
      return
    }
    function tick() {
      frame = undefined
      const step = Math.max(1, Math.ceil(reveal.addedTotal / 10))
      onFrame(reveal.tick(step))
      if (!reveal.isDone()) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  return { start, stop }
}
