'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, TriangleAlert } from 'lucide-react'

import { AppHeader } from '@/components/dashboard/app-header'
import { ResponseTimeChart } from '@/components/charts/response-time-chart'
import { HistoryTable } from '@/components/monitor/history-table'
import { IncidentList } from '@/components/monitor/incident-list'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePoll } from '@/components/ui/use-poll'
import {
  formatNumber,
  formatRelative,
  formatResponseTime,
  formatUptime,
} from '@/lib/utils'
import type {
  HistoryRange,
  HistoryResponse,
  IncidentsResponse,
  StatusResponse,
  UiStatus,
} from '@/lib/types'

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
]

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  )
}

export function MonitorDetail({ monitorId }: { monitorId: string }) {
  const [range, setRange] = React.useState<HistoryRange>('24h')

  const status = usePoll<StatusResponse>('/api/status', 30_000)
  const history = usePoll<HistoryResponse>(
    `/api/history?monitorId=${encodeURIComponent(monitorId)}&range=${range}`,
    60_000,
  )
  const incidents = usePoll<IncidentsResponse>(
    `/api/incidents?monitorId=${encodeURIComponent(monitorId)}`,
    60_000,
  )

  const monitor = status.data?.monitors.find((entry) => entry.id === monitorId) ?? null
  const state = monitor?.state ?? null

  if (status.loading) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="container space-y-6 py-8">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-72 w-full" />
        </main>
      </div>
    )
  }

  if (!monitor) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="container py-16">
          <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <TriangleAlert className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Monitor not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {status.error ?? 'It may have been removed from data/monitors.json.'}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const uiStatus: UiStatus = !monitor.enabled ? 'CHECKING' : (state?.status ?? 'CHECKING')
  const headline = !monitor.enabled
    ? 'Paused'
    : state?.status === 'UP'
      ? 'Operational'
      : state?.status === 'DOWN'
        ? 'Down'
        : 'Waiting for the first check'

  const openIncident = incidents.data?.incidents.find((entry) => entry.status === 'ongoing')

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="container space-y-6 py-8">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/dashboard">
            <ArrowLeft />
            Dashboard
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot status={uiStatus} size="lg" />
              <span
                className={`text-sm font-medium ${
                  uiStatus === 'UP' ? 'text-up' : uiStatus === 'DOWN' ? 'text-down' : ''
                }`}
              >
                {headline}
              </span>
            </div>
            <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight">{monitor.name}</h1>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {monitor.url}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <p className="text-xs text-muted-foreground">
            Checks approximately every 3 minutes
            {state?.lastCheck ? ` · last check ${formatRelative(state.lastCheck)}` : ''}
          </p>
        </div>

        {state?.status === 'DOWN' && state.error && (
          <Card className="flex items-start gap-3 border-down/30 bg-down/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-down" />
            <div className="min-w-0">
              <p className="font-medium text-down">This site is currently down</p>
              <p className="mt-1 break-words text-muted-foreground">{state.error}</p>
              {openIncident && (
                <p className="mt-1 text-muted-foreground">
                  Down since {new Date(openIncident.startedAt).toLocaleString()}.
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <div className="bg-background">
            <Stat label="Uptime · 30d" value={formatUptime(state?.uptime30d)} />
          </div>
          <div className="bg-background">
            <Stat label="Average response" value={formatResponseTime(state?.avgResponse24h)} />
          </div>
          <div className="bg-background">
            <Stat label="Checks" value={formatNumber(state?.totalChecks ?? 0)} />
          </div>
          <div className="bg-background">
            <Stat label="Incidents" value={formatNumber(state?.incidents ?? 0)} />
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Response time</CardTitle>
            <Tabs value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
              <TabsList>
                {RANGES.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </CardHeader>
          <div className="px-2 pb-4">
            {history.loading ? (
              <Skeleton className="mx-3 h-[240px]" />
            ) : (
              <ResponseTimeChart entries={history.data?.entries ?? []} range={range} />
            )}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">History</CardTitle>
            </CardHeader>
            <div className="max-h-[420px] overflow-y-auto border-t border-border">
              {history.loading ? (
                <Skeleton className="m-5 h-64" />
              ) : (
                <HistoryTable entries={history.data?.entries ?? []} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Incidents</CardTitle>
            </CardHeader>
            <div className="max-h-[420px] overflow-y-auto border-t border-border">
              {incidents.loading ? (
                <Skeleton className="m-5 h-64" />
              ) : (
                <IncidentList
                  incidents={incidents.data?.incidents ?? []}
                  monitorName={monitor.name}
                />
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
