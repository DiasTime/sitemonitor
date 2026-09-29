'use client'

import * as React from 'react'

import { EASE_OUT, gsap, prefersReducedMotion, useGSAP } from '@/components/ui/motion'
import { cn } from '@/lib/cn'

export interface FilterOption<K extends string> {
  key: K
  label: string
  count: number
  /** Show the count in the down colour. */
  alert?: boolean
}

/**
 * The list filters. The highlight behind the active tab is a single element
 * that slides from tab to tab, so changing the filter reads as moving along
 * one control rather than two buttons swapping styles.
 *
 * The slide animates `x` and `width`. Width is layout, but this element is
 * absolutely positioned, has no children and is 28px tall, so resizing it
 * costs nothing — and unlike a scale it keeps the corners round.
 */
export function FilterTabs<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: FilterOption<K>[]
  value: K
  onChange: (key: K) => void
  /** Accessible name of the group. */
  label: string
}) {
  const group = React.useRef<HTMLDivElement>(null)
  const highlight = React.useRef<HTMLSpanElement>(null)
  const tabs = React.useRef(new Map<K, HTMLButtonElement>())
  const active = React.useRef(value)
  active.current = value
  const placed = React.useRef(false)

  // Slide to the chosen tab. The first placement is instant: there is nothing
  // to slide from.
  useGSAP(
    () => {
      const tab = tabs.current.get(value)
      if (!tab || !highlight.current) return
      const to = { x: tab.offsetLeft, width: tab.offsetWidth }
      if (placed.current && !prefersReducedMotion()) {
        gsap.to(highlight.current, { ...to, duration: 0.35, ease: EASE_OUT, overwrite: true })
      } else {
        gsap.set(highlight.current, to)
      }
      placed.current = true
    },
    { dependencies: [value] },
  )

  // Tabs change width when a count gains a digit or the webfont arrives; the
  // group's width changes with them. Snap, don't slide: nothing was chosen.
  React.useEffect(() => {
    const element = group.current
    if (!element) return
    let initial = true
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false
        return
      }
      const tab = tabs.current.get(active.current)
      if (!tab || !highlight.current) return
      gsap.killTweensOf(highlight.current)
      gsap.set(highlight.current, { x: tab.offsetLeft, width: tab.offsetWidth })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={group}
      role="group"
      aria-label={label}
      className="relative flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1"
    >
      <span
        ref={highlight}
        aria-hidden
        className="pointer-events-none absolute bottom-1 left-0 top-1 w-0 rounded-md bg-secondary shadow-sm"
      />
      {options.map((option) => (
        <button
          key={option.key}
          ref={(element) => {
            if (element) tabs.current.set(option.key, element)
            else tabs.current.delete(option.key)
          }}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            'relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === option.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
          <span
            className={cn(
              'font-mono tabular text-[10.5px]',
              option.alert ? 'text-down' : 'text-muted-foreground',
            )}
          >
            {option.count}
          </span>
        </button>
      ))}
    </div>
  )
}
