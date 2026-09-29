'use client'

import * as React from 'react'

import { useI18n } from '@/components/i18n/i18n-provider'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { EASE_OUT, gsap, useGSAP, withMotion } from '@/components/ui/motion'
import { cn } from '@/lib/cn'
import type { MonitorWithState } from '@/lib/types'

/** Where the stats start relative to the page heading, and how far apart. */
const ENTRANCE_S = 0.08
const STEP_S = 0.06

function Stat({
  value,
  format,
  label,
  tone,
  order,
}: {
  value: number | null
  format: (value: number | null) => string
  label: string
  tone?: 'up' | 'down'
  /** Position in the row, for the staggered entrance. */
  order: number
}) {
  return (
    <div className="bg-card px-5 py-5 sm:px-6">
      {/* The contents move, not the tile: the gaps between tiles are the
          grid's own background, and a fading tile would flash it. */}
      <div data-stat>
        <div className="text-[13px] text-muted-foreground">{label}</div>
        <div
          className={cn(
            'mt-2.5 text-[1.9rem] font-semibold leading-none tracking-[-0.04em] tabular',
            tone === 'up' && 'text-up',
            tone === 'down' && 'text-down',
          )}
        >
          <AnimatedNumber value={value} format={format} delay={ENTRANCE_S + order * STEP_S} />
        </div>
      </div>
    </div>
  )
}

function average(values: (number | null | undefined)[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number')
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
}

const count = (value: number | null) => String(Math.round(value ?? 0))

/** The headline numbers at the top of the dashboard. */
export function StatsBar({ monitors }: { monitors: MonitorWithState[] }) {
  const { t, format } = useI18n()
  const root = React.useRef<HTMLDivElement>(null)
  const online = monitors.filter((monitor) => monitor.enabled && monitor.state?.status === 'UP').length
  const down = monitors.filter((monitor) => monitor.enabled && monitor.state?.status === 'DOWN').length
  const uptime = average(monitors.map((monitor) => monitor.state?.uptime30d))
  const response = average(monitors.map((monitor) => monitor.state?.avgResponse24h))

  useGSAP(
    () =>
      withMotion(() => {
        gsap.from('[data-stat]', {
          y: 8,
          opacity: 0,
          duration: 0.55,
          ease: EASE_OUT,
          delay: ENTRANCE_S,
          stagger: STEP_S,
          clearProps: 'all',
        })
      }),
    { scope: root },
  )

  return (
    <div
      ref={root}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-panel sm:grid-cols-5"
    >
      <Stat order={0} value={monitors.length} format={count} label={t.stats.monitors} />
      <Stat order={1} value={online} format={count} label={t.stats.online} tone={online ? 'up' : undefined} />
      <Stat order={2} value={down} format={count} label={t.stats.down} tone={down ? 'down' : undefined} />
      <Stat order={3} value={uptime} format={format.uptime} label={t.stats.uptime30d} />
      <div className="col-span-2 sm:col-span-1">
        <Stat order={4} value={response} format={format.responseTime} label={t.stats.avgResponse} />
      </div>
    </div>
  )
}
