import type { AnimationParams, TargetsParam } from 'animejs'

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export async function animateEntrance(targets: TargetsParam, parameters: AnimationParams = {}) {
  if (!motionAllowed()) return
  const { animate, stagger } = await import('animejs')
  return animate(targets, {
    opacity: { from: 0 },
    y: { from: 12 },
    duration: 520,
    delay: stagger(55),
    ease: 'outExpo',
    ...parameters,
  })
}

export async function animateFeedback(target: TargetsParam) {
  if (!motionAllowed()) return
  const { animate } = await import('animejs')
  return animate(target, {
    scale: [{ to: 0.985, duration: 90 }, { to: 1, duration: 260 }],
    ease: 'outCubic',
  })
}
