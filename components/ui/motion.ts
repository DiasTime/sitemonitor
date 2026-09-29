'use client'

import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'

/**
 * The dashboard's motion vocabulary, in one place so every animation on the
 * page speaks the same language: one decelerating ease for things arriving,
 * a springier one for the uptime squares, and nothing that runs for someone
 * who asked their system for less motion.
 */

gsap.registerPlugin(useGSAP)

/** Things settling into place. */
export const EASE_OUT = 'power3.out'
/** The uptime squares: a small overshoot, so the wave reads as a wave. */
export const EASE_SPRING = 'back.out(2)'

/** The query every animation is gated on. */
const MOTION_OK = '(prefers-reduced-motion: no-preference)'

/**
 * Run `animate` only for viewers who have not asked for reduced motion, and
 * hand back the cleanup. Everything animated with `gsap.from` then simply
 * appears in its final state for everyone else, because the from-state is
 * never applied. Meant to be returned from a `useGSAP` callback; `animate` may
 * return its own cleanup, run when the animation is undone.
 */
export function withMotion(animate: () => void | (() => void)): () => void {
  const media = gsap.matchMedia()
  media.add(MOTION_OK, animate)
  return () => media.revert()
}

/** For the one animation that has to decide on the spot rather than be undone later. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !window.matchMedia(MOTION_OK).matches
}

export { gsap, useGSAP }
