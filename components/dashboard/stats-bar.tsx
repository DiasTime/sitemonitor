'use client'

import { useI18n } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/cn'
import type { MonitorWithState } from '@/lib/types'

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  return (
    <div className="bg-card px-5 py-5 sm:px-6">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-2.5 text-[1.9rem] font-semibold leading-none tracking-[-0.04em] tabular',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function average(values: (number | null | undefined)[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number')
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
}

/** The headline numbers at the top of the dashboard. */
export function StatsBar({ monitors }: { monitors: MonitorWithState[] }) {
  const { t, format } = useI18n()
  const online = monitors.filter((monitor) => monitor.enabled && monitor.state?.status === 'UP').length
  const down = monitors.filter((monitor) => monitor.enabled && monitor.state?.status === 'DOWN').length
  const uptime = average(monitors.map((monitor) => monitor.state?.uptime30d))
  const response = average(monitors.map((monitor) => monitor.state?.avgResponse24h))

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-panel sm:grid-cols-5">
      <Stat value={String(monitors.length)} label={t.stats.monitors} />
      <Stat value={String(online)} label={t.stats.online} tone={online ? 'up' : undefined} />
      <Stat value={String(down)} label={t.stats.down} tone={down ? 'down' : undefined} />
      <Stat value={format.uptime(uptime)} label={t.stats.uptime30d} />
      <div className="col-span-2 sm:col-span-1">
        <Stat value={format.responseTime(response)} label={t.stats.avgResponse} />
      </div>
    </div>
  )
}
