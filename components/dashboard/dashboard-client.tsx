'use client'

import * as React from 'react'
import { Globe, RefreshCw, TriangleAlert } from 'lucide-react'

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

export function DashboardClient() {
  const { data, error, loading, refreshing, refresh } = usePoll<StatusResponse>(
    '/api/status',
    POLL_INTERVAL_MS,
  )

  const monitors = data?.monitors ?? []

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="container space-y-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-xs text-muted-foreground" title={formatExact(data?.updatedAt)}>
              Checks approximately every 3 minutes
              {data?.updatedAt ? ` · last run ${formatRelative(data.updatedAt)}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
              Refresh
            </Button>
            <AddMonitorDialog onAdded={refresh} />
          </div>
        </div>

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
