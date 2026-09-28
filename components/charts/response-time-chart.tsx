'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useI18n } from '@/components/i18n/i18n-provider'
import type { Formatters } from '@/lib/i18n/format'
import type { HistoryEntry, HistoryRange } from '@/lib/types'

interface Point {
  time: number
  label: string
  responseTime: number | null
  failures: number
  samples: number
}

/** Fixed number of buckets keeps 30 days of samples from choking the SVG. */
const MAX_POINTS = 160

function bucketise(entries: HistoryEntry[], range: HistoryRange, format: Formatters): Point[] {
  if (!entries.length) return []

  const times = entries.map((entry) => new Date(entry.timestamp).getTime())
  const start = Math.min(...times)
  const end = Math.max(...times)
  const span = Math.max(end - start, 1)
  const bucketMs = Math.max(Math.ceil(span / MAX_POINTS), 60_000)

  const buckets = new Map<number, { total: number; counted: number; failures: number; samples: number }>()

  entries.forEach((entry, index) => {
    const time = times[index]
    if (!Number.isFinite(time)) return
    const key = Math.floor(time / bucketMs) * bucketMs
    const bucket = buckets.get(key) ?? { total: 0, counted: 0, failures: 0, samples: 0 }
    bucket.samples += 1
    if (entry.status === 'DOWN') bucket.failures += 1
    if (entry.responseTime !== null) {
      bucket.total += entry.responseTime
      bucket.counted += 1
    }
    buckets.set(key, bucket)
  })

  const showDate = range !== '24h'

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, bucket]) => ({
      time,
      label: format.chartLabel(time, showDate),
      responseTime: bucket.counted ? Math.round(bucket.total / bucket.counted) : null,
      failures: bucket.failures,
      samples: bucket.samples,
    }))
}

interface TooltipPayloadItem {
  payload: Point
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
}) {
  const { t, format } = useI18n()
  if (!active || !payload?.length) return null
  const point = payload[0].payload

  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{point.label}</div>
      <div className="tabular mt-1 text-muted-foreground">
        {format.responseTime(point.responseTime)}
      </div>
      {point.failures > 0 && (
        <div className="tabular mt-0.5 text-down">
          {t.chart.failed(point.failures)}
        </div>
      )}
    </div>
  )
}

export function ResponseTimeChart({
  entries,
  range,
}: {
  entries: HistoryEntry[]
  range: HistoryRange
}) {
  const { t, format } = useI18n()
  const data = React.useMemo(() => bucketise(entries, range, format), [entries, range, format])

  if (!data.length) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        {t.chart.empty}
      </div>
    )
  }

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="responseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--up))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--up))" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            width={76}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => t.chart.axisMs(value)}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border))' }} />
          <Area
            type="monotone"
            dataKey="responseTime"
            stroke="hsl(var(--up))"
            strokeWidth={1.75}
            fill="url(#responseFill)"
            // Buckets where every check failed have no response time; leaving the
            // gap open makes an outage visible instead of drawing through it.
            connectNulls={false}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
