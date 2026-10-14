'use client'

import * as React from 'react'
import Link from 'next/link'
import { Activity, ArrowLeft, ExternalLink, KeyRound, TriangleAlert } from 'lucide-react'

import { AppHeader } from '@/components/dashboard/app-header'
import { ResponseTimeChart } from '@/components/charts/response-time-chart'
import { useI18n } from '@/components/i18n/i18n-provider'
import { HistoryTable } from '@/components/monitor/history-table'
import { IncidentList } from '@/components/monitor/incident-list'
import { SslBadge } from '@/components/monitor/ssl-badge'
import { ReportDialog } from '@/components/report/report-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePoll } from '@/components/ui/use-poll'
import type {
  HistoryRange,
  HistoryResponse,
  IncidentsResponse,
  StatusResponse,
  UiStatus,
} from '@/lib/types'

const RANGES: HistoryRange[] = ['24h', '7d', '30d']

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
  const { t: messages, format } = useI18n()
  const t = messages.detail
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
              <p className="text-sm font-medium">{t.notFound}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {status.error ?? t.notFoundBody}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">{t.back}</Link>
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const uiStatus: UiStatus = !monitor.enabled ? 'CHECKING' : (state?.status ?? 'CHECKING')
  const headline = !monitor.enabled
    ? t.paused
    : state?.status === 'UP'
      ? t.operational
      : state?.status === 'DOWN'
        ? t.down
        : t.waiting

  const openIncident = incidents.data?.incidents.find((entry) => entry.status === 'ongoing')

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="container space-y-6 py-8">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/dashboard">
            <ArrowLeft />
            {t.backShort}
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
              {state?.reported && (
                <Badge variant={state.status === 'UP' ? 'up' : 'down'}>
                  {t.reported(state.reported)}
                </Badge>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{monitor.name}</h1>
              {monitor.type === 'health' && (
                <Badge variant="outline" className="shrink-0 gap-1">
                  <Activity className="h-3 w-3" />
                  {t.healthEndpoint}
                </Badge>
              )}
              {monitor.type === 'login' && (
                <Badge variant="outline" className="shrink-0 gap-1">
                  <KeyRound className="h-3 w-3" />
                  {t.loginCheck}
                </Badge>
              )}
              <SslBadge expiresAt={monitor.sslExpiresAt} />
            </div>
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

          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground" title={format.exact(state?.lastCheck)}>
              {t.runsOn}
              {state?.lastCheck ? t.lastCheck(format.relative(state.lastCheck)) : ''}
            </p>
            <ReportDialog monitors={status.data?.monitors ?? [monitor]} monitorId={monitor.id} />
          </div>
        </div>

        {state?.status === 'DOWN' && state.error && (
          <Card className="flex items-start gap-3 border-down/30 bg-down/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-down" />
            <div className="min-w-0">
              <p className="font-medium text-down">{t.downTitle}</p>
              <p className="mt-1 break-words text-muted-foreground">{state.error}</p>
              {openIncident && (
                <p className="mt-1 text-muted-foreground">
                  {t.downSince(format.exact(openIncident.startedAt) ?? openIncident.startedAt)}
                </p>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          <div className="bg-background">
            <Stat label={t.uptime30d} value={format.uptime(state?.uptime30d)} />
          </div>
          <div className="bg-background">
            <Stat label={t.avgResponse} value={format.responseTime(state?.avgResponse24h)} />
          </div>
          <div className="bg-background">
            <Stat label={t.checks} value={format.number(state?.totalChecks ?? 0)} />
          </div>
          <div className="bg-background">
            <Stat label={t.incidents} value={format.number(state?.incidents ?? 0)} />
          </div>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{t.responseTime}</CardTitle>
            <Tabs value={range} onValueChange={(value) => setRange(value as HistoryRange)}>
              <TabsList>
                {RANGES.map((option) => (
                  <TabsTrigger key={option} value={option}>
                    {t.ranges[option]}
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
              <CardTitle className="text-sm">{t.history}</CardTitle>
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
              <CardTitle className="text-sm">{t.incidents}</CardTitle>
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
