import { formatUptime } from '@/lib/utils'
import type { MonitorWithState } from '@/lib/types'

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  return (
    <div className="px-5 py-4">
      <div
        className={`tabular text-2xl font-semibold tracking-tight ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

/** The four headline numbers at the top of the dashboard. */
export function StatsBar({ monitors }: { monitors: MonitorWithState[] }) {
  const online = monitors.filter((monitor) => monitor.state?.status === 'UP').length
  const down = monitors.filter((monitor) => monitor.state?.status === 'DOWN').length

  const uptimes = monitors
    .map((monitor) => monitor.state?.uptime30d)
    .filter((value): value is number => typeof value === 'number')
  const uptime = uptimes.length
    ? uptimes.reduce((sum, value) => sum + value, 0) / uptimes.length
    : null

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      <div className="bg-background">
        <Stat value={String(monitors.length)} label="Monitors" />
      </div>
      <div className="bg-background">
        <Stat value={String(online)} label="Online" tone={online ? 'up' : undefined} />
      </div>
      <div className="bg-background">
        <Stat value={String(down)} label="Down" tone={down ? 'down' : undefined} />
      </div>
      <div className="bg-background">
        <Stat value={formatUptime(uptime)} label="Uptime · 30d" />
      </div>
    </div>
  )
}
