import { en, type Messages } from '@/lib/i18n/messages/en'
import { cn } from '@/lib/cn'
import type { HistoryEntry } from '@/lib/types'

export type BucketState = 'up' | 'degraded' | 'down' | 'empty'

export interface Bucket {
  state: BucketState
  /** Tooltip text: the time window and what happened in it. */
  label: string
}

const TONE: Record<BucketState, string> = {
  up: 'bg-up/80 group-hover/bars:bg-up/50 hover:!bg-up',
  degraded: 'bg-checking/85 group-hover/bars:bg-checking/55 hover:!bg-checking',
  down: 'bg-down/85 group-hover/bars:bg-down/55 hover:!bg-down',
  empty: 'bg-muted-foreground/15',
}

/**
 * Split a monitor's samples into `count` equal windows ending at `now`.
 * A window with any failed check is `degraded`, with only failures `down`.
 */
export function bucketHistory(
  entries: HistoryEntry[],
  {
    now,
    count,
    spanMs,
    t = en.bars,
    clock,
  }: {
    now: number
    count: number
    spanMs: number
    t?: Messages['bars']
    clock: (iso: string) => string
  },
): Bucket[] {
  const size = spanMs / count
  const start = now - spanMs
  const tallies = Array.from({ length: count }, () => ({ up: 0, down: 0 }))

  for (const entry of entries) {
    const time = Date.parse(entry.timestamp)
    if (Number.isNaN(time) || time < start || time > now) continue
    const index = Math.min(count - 1, Math.floor((time - start) / size))
    if (entry.status === 'UP') tallies[index].up += 1
    else tallies[index].down += 1
  }

  return tallies.map(({ up, down }, index) => {
    const from = clock(new Date(start + index * size).toISOString())
    const to = clock(new Date(start + (index + 1) * size).toISOString())
    const total = up + down
    if (total === 0) return { state: 'empty', label: t.noChecksWindow(from, to) }
    const state: BucketState = down === 0 ? 'up' : up === 0 ? 'down' : 'degraded'
    const label = down === 0 ? t.allUpWindow(from, to, total) : t.failedWindow(from, to, down, total)
    return { state, label }
  })
}

/** A row of thin bars, one per time window, as on a public status page. */
export function UptimeBars({
  buckets,
  className,
  barClassName,
  t = en.bars,
}: {
  buckets: Bucket[]
  className?: string
  barClassName?: string
  /** Wording for the screen-reader summary; English when omitted. */
  t?: Messages['bars']
}) {
  return (
    <div className={cn('group/bars flex h-7 items-stretch gap-[2px]', className)} role="img" aria-label={summarise(buckets, t)}>
      {buckets.map((bucket, index) => (
        <span
          key={index}
          title={bucket.label || undefined}
          className={cn(
            'min-w-[2px] flex-1 rounded-[2px] transition-colors duration-150',
            TONE[bucket.state],
            barClassName,
          )}
        />
      ))}
    </div>
  )
}

function summarise(buckets: Bucket[], t: Messages['bars']): string {
  const withData = buckets.filter((bucket) => bucket.state !== 'empty')
  if (!withData.length) return t.none
  const bad = withData.filter((bucket) => bucket.state !== 'up').length
  return bad === 0 ? t.allUp : t.some(bad, withData.length)
}
