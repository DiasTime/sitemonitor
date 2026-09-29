'use client'

import * as React from 'react'

import { EASE_OUT, gsap, useGSAP, withMotion } from '@/components/ui/motion'

/**
 * A number that counts to its value instead of appearing: up from zero the
 * first time, and from the old value to the new one when an update changes
 * it, so a change on the board is seen happening rather than missed.
 *
 * The text node React rendered is rewritten in place, never replaced, so
 * React keeps owning it: when the value changes, React writes the new text
 * into the same node the count is running on, and the count takes over from
 * there before the frame is painted.
 */
export function AnimatedNumber({
  value,
  format,
  delay = 0,
}: {
  value: number | null
  format: (value: number | null) => string
  /** Only for the first count, to fall in with an entrance. */
  delay?: number
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  /** The number on screen while and after counting; null before any count. */
  const shown = React.useRef<number | null>(null)
  /** Whether a count has run to the end — the first one is the entrance. */
  const counted = React.useRef(false)
  /** The count in progress, stopped when a newer value takes over. */
  const running = React.useRef<gsap.core.Tween | null>(null)
  // A language switch mid-count must not finish the count in the old format.
  const formatRef = React.useRef(format)
  formatRef.current = format

  useGSAP(
    () => {
      const node = ref.current?.firstChild
      if (!(node instanceof Text) || value === null) return
      const counter = { value: shown.current ?? 0 }
      if (counter.value === value) return
      const first = !counted.current

      const show = () => {
        shown.current = counter.value
        node.nodeValue = formatRef.current(counter.value)
      }
      return withMotion(() => {
        running.current?.kill()
        show()
        running.current = gsap.to(counter, {
          value,
          duration: first ? 0.9 : 0.6,
          delay: first ? delay : 0,
          ease: EASE_OUT,
          onUpdate: show,
          onComplete: () => {
            counted.current = true
          },
        })
        // Undone early (unmount, or reduced motion switched on mid-count):
        // show the real value, which is what React believes the node says.
        return () => {
          node.nodeValue = formatRef.current(value)
        }
      })
    },
    { dependencies: [value] },
  )

  return <span ref={ref}>{format(value)}</span>
}
