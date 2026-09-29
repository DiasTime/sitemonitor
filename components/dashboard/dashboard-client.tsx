'use client'

import * as React from 'react'
import { Globe, Play, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'

import { AddMonitorDialog } from '@/components/dashboard/add-monitor-dialog'
import { AppHeader } from '@/components/dashboard/app-header'
import { FilterTabs } from '@/components/dashboard/filter-tabs'
import { useI18n } from '@/components/i18n/i18n-provider'
import { MonitorRow } from '@/components/dashboard/monitor-row'
import { StatsBar } from '@/components/dashboard/stats-bar'
import { Button } from '@/components/ui/button'
import { EASE_OUT, gsap, useGSAP, withMotion } from '@/components/ui/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { usePoll } from '@/components/ui/use-poll'
import { bucketHistory, type Bucket } from '@/components/ui/uptime-bars'
import type { Messages } from '@/lib/i18n/messages'
import { cn } from '@/lib/cn'
import { hostnameOf } from '@/lib/utils'
import type { HistoryEntry, HistoryResponse, MonitorWithState, StatusResponse } from '@/lib/types'

const POLL_INTERVAL_MS = 30_000
/** History only feeds the 24h bars, which move slowly; no need to pull it as often. */
const HISTORY_POLL_MS = 180_000
/** While a manual run is in flight, look for its result more eagerly. */
const RUNNING_POLL_MS = 10_000
/** A single-pass run takes well under a minute; give up waiting after four. */
const RUNNING_TIMEOUT_MS = 240_000

const DAY_MS = 24 * 60 * 60 * 1000
/** One bar per hour: the schedule aims for one run an hour, so finer bars would show gaps. */
const BAR_COUNT = 24

/**
 * The opening wave: the first row's squares start rising this long after the
 * history arrives, each next row one reveal step later — in step with the
 * rows' own entrance, so squares never rise inside a row still fading in.
 */
const WAVE_START_S = 0.2
const WAVE_ROW_STEP_S = 0.07

type Filter = 'all' | 'down' | 'up' | 'paused'
const FILTERS: Filter[] = ['all', 'down', 'up', 'paused']

function matchesFilter(monitor: MonitorWithState, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'paused') return !monitor.enabled
  if (!monitor.enabled) return false
  return filter === 'down' ? monitor.state?.status === 'DOWN' : monitor.state?.status === 'UP'
}

export function DashboardClient() {
  const { t, format } = useI18n()
  const d = t.dashboard
  const { data, error, loading, refreshing, refresh } = usePoll<StatusResponse>(
    '/api/status',
    POLL_INTERVAL_MS,
  )
  const history = usePoll<HistoryResponse>('/api/history?range=24h', HISTORY_POLL_MS)

  const [running, setRunning] = React.useState(false)
  const [runError, setRunError] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<Filter>('all')
  const [query, setQuery] = React.useState('')
  // The updatedAt we started from; the run is done once it changes.
  const baseline = React.useRef<string | null>(null)
  const heading = React.useRef<HTMLDivElement>(null)

  // The squares' wave plays once, when the page first has both the list and
  // its history. After that, squares that appear (a filter switch, a monitor
  // added) are simply there, and polling never replays it.
  const [introPlayed, setIntroPlayed] = React.useState(false)
  React.useEffect(() => {
    if (data && history.data) setIntroPlayed(true)
  }, [data, history.data])

  // The heading arrives first, the stats and rows cascade in below it.
  useGSAP(
    () => {
      if (loading || !heading.current) return
      return withMotion(() => {
        gsap.from(heading.current!.children, {
          y: 10,
          opacity: 0,
          duration: 0.6,
          ease: EASE_OUT,
          stagger: 0.07,
          clearProps: 'all',
        })
      })
    },
    { dependencies: [loading] },
  )

  async function runCheck() {
    setRunError(null)
    baseline.current = data?.updatedAt ?? null
    setRunning(true)
    try {
      const response = await fetch('/api/check', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setRunError(typeof body?.error === 'string' ? body.error : d.runErrorFallback)
        setRunning(false)
      }
    } catch (cause) {
      setRunError((cause as Error).message)
      setRunning(false)
    }
  }

  // Poll harder while waiting, and stop once the run has committed its results.
  React.useEffect(() => {
    if (!running) return
    const startedAt = Date.now()
    const id = setInterval(() => {
      if (Date.now() - startedAt > RUNNING_TIMEOUT_MS) {
        setRunning(false)
        setRunError(d.runTimeout)
        return
      }
      refresh()
    }, RUNNING_POLL_MS)
    return () => clearInterval(id)
  }, [running, refresh, d.runTimeout])

  const refreshHistory = history.refresh
  React.useEffect(() => {
    if (running && data?.updatedAt && data.updatedAt !== baseline.current) {
      setRunning(false)
      refreshHistory()
    }
  }, [running, data?.updatedAt, refreshHistory])

  const reloadAll = React.useCallback(() => {
    refresh()
    refreshHistory()
  }, [refresh, refreshHistory])

  const monitors = React.useMemo(() => data?.monitors ?? [], [data])

  const bucketsById = React.useMemo(() => {
    if (!history.data) return null
    const byMonitor = new Map<string, HistoryEntry[]>()
    for (const entry of history.data.entries) {
      const list = byMonitor.get(entry.monitorId)
      if (list) list.push(entry)
      else byMonitor.set(entry.monitorId, [entry])
    }
    const now = Date.now()
    const result = new Map<string, Bucket[]>()
    for (const monitor of monitors) {
      result.set(
        monitor.id,
        bucketHistory(byMonitor.get(monitor.id) ?? [], {
          now,
          count: BAR_COUNT,
          spanMs: DAY_MS,
          t: t.bars,
          clock: format.clock,
        }),
      )
    }
    return result
  }, [history.data, monitors, t.bars, format.clock])

  const counts: Record<Filter, number> = {
    all: monitors.length,
    down: monitors.filter((monitor) => matchesFilter(monitor, 'down')).length,
    up: monitors.filter((monitor) => matchesFilter(monitor, 'up')).length,
    paused: monitors.filter((monitor) => matchesFilter(monitor, 'paused')).length,
  }

  const needle = query.trim().toLowerCase()
  const visible = monitors.filter(
    (monitor) =>
      matchesFilter(monitor, filter) &&
      (!needle ||
        monitor.name.toLowerCase().includes(needle) ||
        hostnameOf(monitor.url).toLowerCase().includes(needle)),
  )

  return (
    <div className="min-h-[100dvh]">
      <AppHeader />

      <main className="container space-y-8 pb-20 pt-10">
        {/* Overall status */}
        <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div ref={heading} className="min-w-0">
            {loading ? (
              <>
                <Skeleton className="h-9 w-72" />
                <Skeleton className="mt-3 h-4 w-52" />
              </>
            ) : (
              <>
                <OverallStatus down={counts.down} total={monitors.length} t={d} />
                <p className="mt-2.5 text-sm text-muted-foreground" title={format.exact(data?.updatedAt)}>
                  {/* The cadence lives in the workflow's LOOP_MINUTES, which the
                      dashboard cannot see, so report the fact, not a promise. */}
                  {d.runsOn}
                  {data?.updatedAt ? `. ${d.lastRun(format.relative(data.updatedAt))}` : '.'}
                </p>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={reloadAll}
              disabled={refreshing}
              aria-label={d.reload}
              title={d.reload}
            >
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
            </Button>
            <Button variant="outline" size="sm" onClick={runCheck} disabled={running}>
              {running ? <RefreshCw className="animate-spin" /> : <Play />}
              {running ? d.checking : d.runCheck}
            </Button>
            <AddMonitorDialog onAdded={reloadAll} />
          </div>
        </section>

        {running && (
          <Notice icon={<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />} title={d.runningTitle}>
            {d.runningBody}
          </Notice>
        )}
        {runError && (
          <Notice tone="down" icon={<TriangleAlert className="h-4 w-4 text-down" />} title={d.runErrorTitle}>
            {runError}
          </Notice>
        )}
        {error && (
          <Notice tone="down" icon={<TriangleAlert className="h-4 w-4 text-down" />} title={d.loadErrorTitle}>
            {error}
          </Notice>
        )}

        {!loading && !data ? null : loading ? (
          <>
            <Skeleton className="h-[90px] w-full rounded-xl" />
            <ListSkeleton />
          </>
        ) : (
          <>
            <StatsBar monitors={monitors} />

            {monitors.length === 0 ? (
              <EmptyState onAdded={reloadAll} t={d} />
            ) : (
              <section aria-label={d.listLabel} className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <FilterTabs
                    label={d.filterLabel}
                    value={filter}
                    onChange={setFilter}
                    options={FILTERS.map((key) => ({
                      key,
                      label: d.filters[key],
                      count: counts[key],
                      alert: key === 'down' && counts.down > 0,
                    }))}
                  />

                  <label className="relative block sm:w-64">
                    <span className="sr-only">{d.search}</span>
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={d.searchPlaceholder}
                      className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        aria-label={d.clearSearch}
                        className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </label>
                </div>

                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-panel">
                  <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_76px_76px_36px] gap-x-6 border-b border-border bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground lg:grid">
                    <span className="pl-[1.4rem]">{d.columns.monitor}</span>
                    <span>{d.columns.history}</span>
                    <span className="text-right">{d.columns.response}</span>
                    <span className="text-right">{d.columns.uptime}</span>
                    <span />
                  </div>

                  {visible.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                      <p className="text-sm font-medium">{d.noMatchTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {d.noMatchBody}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          setFilter('all')
                          setQuery('')
                        }}
                      >
                        {d.showAll}
                      </Button>
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {visible.map((monitor, index) => (
                        <MonitorRow
                          key={monitor.id}
                          index={index}
                          monitor={monitor}
                          buckets={bucketsById?.get(monitor.id) ?? null}
                          waveDelay={introPlayed ? null : WAVE_START_S + Math.min(index, 10) * WAVE_ROW_STEP_S}
                          onChanged={reloadAll}
                        />
                      ))}
                    </ul>
                  )}
                </div>
                {history.error && (
                  <p className="text-xs text-muted-foreground">
                    {d.historyError(history.error)}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function OverallStatus({ down, total, t }: { down: number; total: number; t: Messages['dashboard'] }) {
  if (total === 0) {
    return <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">{t.title}</h1>
  }
  return (
    <div className="flex items-center gap-3.5">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          down ? 'bg-down/10' : 'bg-up/10',
        )}
      >
        <StatusDot status={down ? 'DOWN' : 'UP'} size="lg" pulse />
      </span>
      <h1 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
        {down ? t.down(down, total) : t.allOperational}
      </h1>
    </div>
  )
}

function Notice({
  icon,
  title,
  children,
  tone,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  tone?: 'down'
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  // A run starting or a request failing is news: it slides in rather than
  // shoving the page down in a single frame.
  useGSAP(
    () =>
      withMotion(() => {
        gsap.from(ref.current, { y: -6, opacity: 0, duration: 0.35, ease: EASE_OUT, clearProps: 'all' })
      }),
    { scope: ref },
  )

  return (
    <div
      ref={ref}
      role={tone === 'down' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm',
        tone === 'down' ? 'border-down/30 bg-down/[0.06]' : 'border-border bg-muted/50',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className={cn('font-medium', tone === 'down' && 'text-down')}>{title}</p>
        <p className="mt-1 break-words text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="grid gap-4 border-b border-border px-5 py-5 last:border-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_76px_76px_36px] lg:items-center">
          <div className="flex items-center gap-3">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="hidden h-4 w-14 justify-self-end lg:block" />
          <Skeleton className="hidden h-4 w-14 justify-self-end lg:block" />
          <span />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ onAdded, t }: { onAdded: () => void; t: Messages['dashboard'] }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-dashed border-border bg-card px-6 py-20 text-center">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="relative mx-auto flex max-w-sm flex-col items-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background shadow-panel">
          <Globe className="h-5 w-5 text-muted-foreground" />
        </span>
        <h2 className="mt-5 text-lg font-semibold tracking-tight">{t.emptyTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.emptyBody}
        </p>
        <div className="mt-6">
          <AddMonitorDialog onAdded={onAdded} />
        </div>
      </div>
    </section>
  )
}
