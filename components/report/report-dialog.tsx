'use client'

import * as React from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'

import { useI18n } from '@/components/i18n/i18n-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/cn'
import { MAX_REPORT_DAYS, type Report } from '@/lib/report'
import type { Monitor } from '@/lib/types'

type Preset = 'week' | 'days30' | 'thisMonth' | 'lastMonth'
const PRESETS: Preset[] = ['week', 'days30', 'thisMonth', 'lastMonth']

/** Check history is trimmed after this many days by default (HISTORY_RETENTION_DAYS). */
const HISTORY_DAYS = 30
const DAY_MS = 24 * 3600_000

/** A date input's value for a local calendar day: "2026-09-01". */
function dayValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local midnight of a date input's value. */
function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function presetRange(preset: Preset, today: Date): { from: string; to: string } {
  const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()]
  switch (preset) {
    case 'week':
      return { from: dayValue(new Date(y, m, d - 6)), to: dayValue(today) }
    case 'days30':
      return { from: dayValue(new Date(y, m, d - 29)), to: dayValue(today) }
    case 'thisMonth':
      return { from: dayValue(new Date(y, m, 1)), to: dayValue(today) }
    case 'lastMonth':
      return { from: dayValue(new Date(y, m - 1, 1)), to: dayValue(new Date(y, m, 0)) }
  }
}

// The PDF engine and the Geist files load on the first report, not with the dashboard.
let fontsRegistered = false

async function renderPdf(report: Report): Promise<Blob> {
  const [{ pdf }, { ReportDocument, registerReportFonts }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/report/report-document'),
  ])
  if (!fontsRegistered) {
    registerReportFonts(`${window.location.origin}/fonts/report`)
    fontsRegistered = true
  }
  return pdf(<ReportDocument report={report} />).toBlob()
}

function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Some browsers start the download after the click returns; give them a moment.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * The "Report" button and its dialog: pick a period (and optionally one
 * monitor), get a PDF of every outage in it. The PDF is always in Russian.
 */
export function ReportDialog({
  monitors,
  monitorId,
  className,
}: {
  monitors: Pick<Monitor, 'id' | 'name'>[]
  /** Preselects a monitor, as on its own page. */
  monitorId?: string
  className?: string
}) {
  const { t: messages } = useI18n()
  const t = messages.report
  const [open, setOpen] = React.useState(false)
  const [preset, setPreset] = React.useState<Preset | ''>('days30')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [scope, setScope] = React.useState(monitorId ?? '')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const today = dayValue(new Date())

  function applyPreset(next: Preset) {
    const range = presetRange(next, new Date())
    setPreset(next)
    setFrom(range.from)
    setTo(range.to)
    setError(null)
  }

  // A fresh dialog starts from the last 30 days each time it opens.
  React.useEffect(() => {
    if (!open) return
    const range = presetRange('days30', new Date())
    setPreset('days30')
    setFrom(range.from)
    setTo(range.to)
    setError(null)
    setScope(monitorId ?? '')
  }, [open, monitorId])

  const start = parseDay(from)
  const end = parseDay(to)
  const invalid = !start || !end || start > end
  const tooLong = !invalid && (end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_REPORT_DAYS
  const beforeHistory = start !== null && Date.now() - start.getTime() > HISTORY_DAYS * DAY_MS

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!start || !end || invalid || tooLong) return
    setPending(true)
    setError(null)

    try {
      // Whole local days: from the first midnight to the midnight after the last day.
      const until = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
      const params = new URLSearchParams({
        from: start.toISOString(),
        to: new Date(Math.min(until.getTime(), Date.now())).toISOString(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      if (scope) params.set('monitorId', scope)

      const response = await fetch(`/api/report?${params}`)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : t.failed)
        return
      }

      const report = body as Report
      const blob = await renderPdf(report)
      const subject = scope ? report.monitors[0]?.name : null
      saveFile(blob, `Отчёт о доступности${subject ? `, ${subject}` : ''}, ${from} - ${to}.pdf`)
      setOpen(false)
    } catch (cause) {
      setError((cause as Error).message || t.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className} title={t.title}>
          <FileText />
          <span className="max-sm:sr-only">{t.button}</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <span className="text-sm font-medium leading-none">{t.period}</span>
            <Tabs value={preset} onValueChange={(value) => applyPreset(value as Preset)}>
              <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                {PRESETS.map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {t.presets[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="report-from">{t.from}</Label>
              <Input
                id="report-from"
                type="date"
                required
                max={today}
                className="[color-scheme:light] dark:[color-scheme:dark]"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value)
                  setPreset('')
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-to">{t.to}</Label>
              <Input
                id="report-to"
                type="date"
                required
                max={today}
                className="[color-scheme:light] dark:[color-scheme:dark]"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value)
                  setPreset('')
                }}
              />
            </div>
          </div>

          {(invalid || tooLong || beforeHistory) && (
            <p className={cn('text-xs', invalid || tooLong ? 'text-down' : 'text-muted-foreground')}>
              {invalid ? t.invalidRange : tooLong ? t.tooLong : t.retentionNote}
            </p>
          )}

          {monitors.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="report-scope">{t.scope}</Label>
              <select
                id="report-scope"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <option value="">{t.allMonitors}</option>
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-down">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending || invalid || tooLong}>
              {pending ? <Loader2 className="animate-spin" /> : <Download />}
              {pending ? t.building : t.download}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
