'use client'

import * as React from 'react'
import { Globe, Play, RefreshCw, TriangleAlert } from 'lucide-react'

import { AddMonitorDialog } from '@/components/dashboard/add-monitor-dialog'
import { AppHeader } from '@/components/dashboard/app-header'
import { MonitorCard } from '@/components/dashboard/monitor-card'
import { StatsBar } from '@/components/dashboard/stats-bar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePoll } from '@/components/ui/use-poll'
import { formatExact, formatRelative } from '@/lib/utils'
import type { StatusResponse } from '@/lib/types'

const POLL_INTERVAL_MS = 30_000
/** While a manual run is in flight, look for its result more eagerly. */
const RUNNING_POLL_MS = 10_000
/** A single-pass run takes well under a minute; give up waiting after four. */
const RUNNING_TIMEOUT_MS = 240_000

export function DashboardClient() {
  const { data, error, loading, refreshing, refresh } = usePoll<StatusResponse>(
    '/api/status',
    POLL_INTERVAL_MS,
  )

  const [running, setRunning] = React.useState(false)
  const [runError, setRunError] = React.useState<string | null>(null)
  // The updatedAt we started from; the run is done once it changes.
  const baseline = React.useRef<string | null>(null)

  async function runCheck() {
    setRunError(null)
    baseline.current = data?.updatedAt ?? null
    setRunning(true)
    try {
      const response = await fetch('/api/check', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setRunError(typeof body?.error === 'string' ? body.error : 'Could not start a check')
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
        setRunError('The check did not report back in time. Look at the Actions tab.')
        return
      }
      refresh()
    }, RUNNING_POLL_MS)
    return () => clearInterval(id)
  }, [running, refresh])

  React.useEffect(() => {
    if (running && data?.updatedAt && data.updatedAt !== baseline.current) {
      setRunning(false)
    }
  }, [running, data?.updatedAt])

  const monitors = data?.monitors ?? []

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="container space-y-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-xs text-muted-foreground" title={formatExact(data?.updatedAt)}>
              {/* The cadence lives in the workflow's LOOP_MINUTES, which the
                  dashboard cannot see — so report the fact, not a promise. */}
              Checks run on GitHub Actions
              {data?.updatedAt ? ` · last run ${formatRelative(data.updatedAt)}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Reload data"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
              Reload
            </Button>
            <Button variant="outline" size="sm" onClick={runCheck} disabled={running}>
              {running ? <RefreshCw className="animate-spin" /> : <Play />}
              {running ? 'Checking…' : 'Run check'}
            </Button>
            <AddMonitorDialog onAdded={refresh} />
          </div>
        </div>

        {running && (
          <Card className="flex items-start gap-3 border-border bg-muted/40 p-4 text-sm">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">Check running on GitHub Actions</p>
              <p className="mt-1 text-muted-foreground">
                Every monitor is being probed now. Results usually appear within a minute.
              </p>
            </div>
          </Card>
        )}

        {runError && (
          <Card className="flex items-start gap-3 border-down/30 bg-down/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-down" />
            <div className="min-w-0">
              <p className="font-medium text-down">Could not start a check</p>
              <p className="mt-1 break-words text-muted-foreground">{runError}</p>
            </div>
          </Card>
        )}

        {error && (
          <Card className="flex items-start gap-3 border-down/30 bg-down/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-down" />
            <div className="min-w-0">
              <p className="font-medium text-down">Could not load monitor data</p>
              <p className="mt-1 break-words text-muted-foreground">{error}</p>
            </div>
          </Card>
        )}

        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-[92px] w-full" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className="h-[188px] w-full" />
              ))}
            </div>
          </div>
        ) : (
          <>
            <StatsBar monitors={monitors} />

            {monitors.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <Globe className="h-6 w-6 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No websites yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add your first website to start monitoring it.
                  </p>
                </div>
                <AddMonitorDialog onAdded={refresh} />
              </Card>
            ) : (
              <div className="grid animate-fade-in gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {monitors.map((monitor) => (
                  <MonitorCard key={monitor.id} monitor={monitor} onChanged={refresh} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
