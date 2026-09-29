'use client'

import * as React from 'react'

import { EASE_SPRING, gsap, useGSAP, withMotion } from '@/components/ui/motion'

/** Gap between neighbouring squares starting, left to right. */
const SQUARE_STEP_S = 0.014

/**
 * The uptime squares' entrance: each one grows up from its baseline, left to
 * right, from "24 hours ago" towards "now". Rows start one after another, so
 * down the list the squares rise as a single diagonal wave.
 *
 * `delay` is when this row's wave starts, or null once the page's opening
 * wave has played: squares that appear later (a filter switch, a monitor just
 * added) should simply be there, not replay the entrance. The squares are the
 * children of `bars`, which exists only once the history has arrived — hence
 * `ready`.
 */
export function useBarsWave(
  bars: React.RefObject<HTMLElement | null>,
  { ready, delay }: { ready: boolean; delay: number | null },
) {
  useGSAP(
    () => {
      const row = bars.current
      if (!ready || delay === null || !row) return
      return withMotion(() => {
        gsap.from(row.children, {
          scaleY: 0,
          opacity: 0,
          transformOrigin: '50% 100%',
          duration: 0.45,
          ease: EASE_SPRING,
          stagger: SQUARE_STEP_S,
          delay,
          // Hand the squares back to their CSS, whose hover lift is a transform too.
          clearProps: 'all',
        })
      })
    },
    { dependencies: [ready, delay] },
  )
}
