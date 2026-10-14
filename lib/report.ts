/**
 * The uptime report: what went down in a chosen period, when, for how long and
 * how often. Pure, so the API route and the tests share it; the PDF itself is
 * drawn from the result in the browser, see components/report.
 *
 * Availability here is measured in time, not in checks: the share of the period
 * a monitor spent without an open incident. Checks run roughly hourly and the
 * schedule drops some of them, so counting checks would weigh a quiet hour the
 * same as a missed one. History is trimmed after HISTORY_RETENTION_DAYS, which
 * is why check counts and response times can cover less than the period while
 * incidents, which are kept, still cover all of it.
 */

import { hostnameOf } from './utils'
import type { HistoryEntry, Incident, Monitor, MonitorType } from './types'

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

/** A year and a day, so "the same date last year" still fits. */
export const MAX_REPORT_DAYS = 366

export type ReportUnit = 'hour' | 'day' | 'week'

export interface ReportMonitor {
  id: string
  name: string
  host: string
  type: MonitorType
  enabled: boolean
  /** Percent of the observed part of the period without an open incident; null if none of it was observed. */
  availability: number | null
  incidents: number
  /** Downtime inside the period, so an outage that began before it only counts from its start. */
  downtimeMs: number
  longestMs: number
  checks: number
  failedChecks: number
  avgResponseMs: number | null
}

export interface ReportIncident {
  id: string
  monitorId: string
  monitorName: string
  startedAt: string
  /** Null while it is still going on. */
  endedAt: string | null
  /** The whole outage, also the part outside the period; until now for an ongoing one. */
  durationMs: number
  cause: string
}

export interface ReportBucket {
  start: string
  end: string
  /** Incidents that began in this bucket; one already open when the period began counts in the first. */
  incidents: number
  downtimeMs: number
}

export interface ReportCause {
  cause: string
  incidents: number
  downtimeMs: number
}

export interface Report {
  from: string
  /** The requested end, or now when that is still ahead. */
  to: string
  generatedAt: string
  timeZone: string
  /** Set when the report covers a single monitor. */
  monitorId: string | null
  unit: ReportUnit
  /** Oldest check still in history; check counts before it have aged out. */
  historyFrom: string | null
  totals: {
    monitors: number
    /** Monitors with at least one incident in the period. */
    affected: number
    incidents: number
    downtimeMs: number
    availability: number | null
    /** Mean time to recovery: downtime per incident. */
    mttrMs: number | null
    longest: { monitorName: string; durationMs: number } | null
    checks: number
    failedChecks: number
  }
  /** Worst first: lowest availability, then most incidents. */
  monitors: ReportMonitor[]
  /** Oldest first. */
  incidents: ReportIncident[]
  buckets: ReportBucket[]
  /** Most frequent first. */
  causes: ReportCause[]
}

export interface BuildReportInput {
  monitors: Monitor[]
  incidents: Incident[]
  history: HistoryEntry[]
  from: number
  to: number
  now: number
  /** IANA zone the hour, day and week boundaries are drawn in. */
  timeZone: string
  monitorId?: string | null
}

// --- time zones --------------------------------------------------------------

const zoneFormats = new Map<string, Intl.DateTimeFormat>()

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    zoneFormats.set(timeZone, format)
  }
  return format
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false
  try {
    zoneFormat(value)
    return true
  } catch {
    return false
  }
}

/** How far the zone's wall clock is ahead of UTC at `time`. */
export function zoneOffsetMs(time: number, timeZone: string): number {
  const parts = zoneFormat(timeZone).formatToParts(new Date(time))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(time / 1000) * 1000
}

/** Local midnight of the day `time` falls on. */
export function startOfZonedDay(time: number, timeZone: string): number {
  const offset = zoneOffsetMs(time, timeZone)
  const localMidnight = Math.floor((time + offset) / DAY_MS) * DAY_MS
  // Midnight can carry a different offset than `time` when a DST switch falls in between.
  return localMidnight - zoneOffsetMs(localMidnight - offset, timeZone)
}

/** Buckets small enough to see a pattern, few enough to read: hours, days, then weeks. */
export function reportUnit(spanMs: number): ReportUnit {
  if (spanMs <= 2 * DAY_MS) return 'hour'
  if (spanMs <= 62 * DAY_MS) return 'day'
  return 'week'
}

function bucketBounds(from: number, to: number, unit: ReportUnit, timeZone: string): number[] {
  const bounds: number[] = []
  if (unit === 'hour') {
    const offset = zoneOffsetMs(from, timeZone)
    let time = from - (((from + offset) % HOUR_MS) + HOUR_MS) % HOUR_MS
    while (time < to) {
      bounds.push(time)
      time += HOUR_MS
    }
  } else {
    const days = unit === 'week' ? 7 : 1
    let time = startOfZonedDay(from, timeZone)
    while (time < to) {
      bounds.push(time)
      // 26 hours always lands inside the next day, whether today had 23, 24 or 25.
      for (let i = 0; i < days; i += 1) time = startOfZonedDay(time + 26 * HOUR_MS, timeZone)
    }
  }
  bounds.push(Math.max(to, (bounds[bounds.length - 1] ?? from) + 1))
  return bounds
}

// --- causes ------------------------------------------------------------------

/**
 * Probe errors used to be written in English and are Russian now; the older
 * wording is mapped onto the current one so the same failure groups together.
 */
const LEGACY_CAUSES: Record<string, string> = {
  'Connection timeout': 'Таймаут соединения',
  'Connection reset by peer': 'Соединение разорвано удалённой стороной',
  'Connection refused': 'Соединение отклонено',
}

export function incidentCause(incident: Pick<Incident, 'error' | 'statusCode'>): string {
  const error = incident.error?.trim()
  if (error) return LEGACY_CAUSES[error] ?? error
  return incident.statusCode ? `HTTP ${incident.statusCode}` : '?'
}

// --- the report --------------------------------------------------------------

interface Span {
  start: number
  end: number
}

function overlap(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

function parseTime(iso: string | null | undefined): number {
  const time = iso ? Date.parse(iso) : NaN
  return Number.isFinite(time) ? time : NaN
}

export function buildReport(input: BuildReportInput): Report {
  const { from, now, timeZone } = input
  const to = Math.min(input.to, now)
  const period: Span = { start: from, end: to }

  const scope = input.monitorId
    ? input.monitors.filter((monitor) => monitor.id === input.monitorId)
    : input.monitors
  const names = new Map(scope.map((monitor) => [monitor.id, monitor.name]))

  // Incidents touching the period, each with its real span: an open one runs until now.
  const touching = input.incidents
    .filter((incident) => names.has(incident.monitorId))
    .map((incident) => {
      const start = parseTime(incident.startedAt)
      const ended = parseTime(incident.endedAt)
      const end = incident.endedAt === null ? now : Number.isFinite(ended) ? ended : start
      return { incident, span: { start, end } }
    })
    .filter(({ span }) => Number.isFinite(span.start) && span.start < to && span.end > from)
    .sort((a, b) => a.span.start - b.span.start)

  const historyFrom = input.history.reduce<string | null>(
    (oldest, entry) => (oldest === null || entry.timestamp < oldest ? entry.timestamp : oldest),
    null,
  )

  // Time each monitor was watched during the period: from its creation if that came later.
  let observedMs = 0

  const monitors: ReportMonitor[] = scope.map((monitor) => {
    const created = parseTime(monitor.createdAt)
    const observed: Span = { start: Number.isFinite(created) ? Math.max(from, created) : from, end: to }
    const windowMs = Math.max(0, observed.end - observed.start)
    observedMs += windowMs

    const own = touching.filter(({ incident }) => incident.monitorId === monitor.id)
    const downtimes = own.map(({ span }) => overlap(span, observed))
    const downtimeMs = downtimes.reduce((sum, value) => sum + value, 0)

    let checks = 0
    let failedChecks = 0
    let responseSum = 0
    let responseCount = 0
    for (const entry of input.history) {
      if (entry.monitorId !== monitor.id) continue
      const time = parseTime(entry.timestamp)
      if (!(time >= observed.start && time <= observed.end)) continue
      checks += 1
      if (entry.status === 'DOWN') failedChecks += 1
      else if (entry.responseTime !== null) {
        responseSum += entry.responseTime
        responseCount += 1
      }
    }

    return {
      id: monitor.id,
      name: monitor.name,
      host: hostnameOf(monitor.url),
      type: monitor.type ?? 'website',
      enabled: monitor.enabled,
      availability: windowMs > 0 ? Math.max(0, 100 * (1 - downtimeMs / windowMs)) : null,
      incidents: own.length,
      downtimeMs,
      longestMs: downtimes.reduce((max, value) => Math.max(max, value), 0),
      checks,
      failedChecks,
      avgResponseMs: responseCount ? Math.round(responseSum / responseCount) : null,
    }
  })

  monitors.sort(
    (a, b) =>
      (a.availability ?? 101) - (b.availability ?? 101) ||
      b.incidents - a.incidents ||
      a.name.localeCompare(b.name),
  )

  const incidents: ReportIncident[] = touching.map(({ incident, span }) => ({
    id: incident.id,
    monitorId: incident.monitorId,
    monitorName: names.get(incident.monitorId) ?? incident.monitorId,
    startedAt: incident.startedAt,
    endedAt: incident.endedAt,
    durationMs: span.end - span.start,
    cause: incidentCause(incident),
  }))

  const unit = reportUnit(to - from)
  const bounds = bucketBounds(from, to, unit, timeZone)
  const buckets: ReportBucket[] = bounds.slice(0, -1).map((start, index) => {
    const bucket: Span = { start, end: bounds[index + 1] }
    let count = 0
    let downtimeMs = 0
    for (const { span } of touching) {
      const clipped: Span = { start: Math.max(span.start, from), end: Math.min(span.end, to) }
      if (clipped.start >= bucket.start && clipped.start < bucket.end) count += 1
      downtimeMs += overlap(clipped, bucket)
    }
    return {
      start: new Date(bucket.start).toISOString(),
      end: new Date(bucket.end).toISOString(),
      incidents: count,
      downtimeMs,
    }
  })

  const byCause = new Map<string, ReportCause>()
  for (const { incident, span } of touching) {
    const cause = incidentCause(incident)
    const entry = byCause.get(cause) ?? { cause, incidents: 0, downtimeMs: 0 }
    entry.incidents += 1
    entry.downtimeMs += overlap(span, period)
    byCause.set(cause, entry)
  }
  const causes = [...byCause.values()].sort(
    (a, b) => b.incidents - a.incidents || b.downtimeMs - a.downtimeMs,
  )

  const downtimeMs = monitors.reduce((sum, monitor) => sum + monitor.downtimeMs, 0)
  const incidentCount = monitors.reduce((sum, monitor) => sum + monitor.incidents, 0)
  const worst = monitors.reduce<ReportMonitor | null>(
    (best, monitor) => (monitor.longestMs > (best?.longestMs ?? 0) ? monitor : best),
    null,
  )

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    generatedAt: new Date(now).toISOString(),
    timeZone,
    monitorId: input.monitorId ?? null,
    unit,
    historyFrom,
    totals: {
      monitors: monitors.length,
      affected: monitors.filter((monitor) => monitor.incidents > 0).length,
      incidents: incidentCount,
      downtimeMs,
      availability: observedMs > 0 ? Math.max(0, 100 * (1 - downtimeMs / observedMs)) : null,
      mttrMs: incidentCount ? Math.round(downtimeMs / incidentCount) : null,
      longest: worst ? { monitorName: worst.name, durationMs: worst.longestMs } : null,
      checks: monitors.reduce((sum, monitor) => sum + monitor.checks, 0),
      failedChecks: monitors.reduce((sum, monitor) => sum + monitor.failedChecks, 0),
    },
    monitors,
    incidents,
    buckets,
    causes,
  }
}

// --- formatting for the PDF -----------------------------------------------------
// The report is always in Russian, whatever language the dashboard is in.

/**
 * Availability with two decimals, never rounded up to a clean 100 while there
 * was any downtime at all: 99.996 reads "99,99%", not "100%".
 */
export function formatAvailability(value: number | null): string {
  if (value === null) return '—'
  if (value >= 100) return '100%'
  return `${Math.min(Math.floor(value * 100) / 100, 99.99).toFixed(2).replace('.', ',')}%`
}

/** Short durations for table cells: "3 ч 5 мин", "2 д 4 ч". Joined with no-break spaces, so a line never splits one. */
export function formatSpan(ms: number | null): string {
  if (ms === null) return '—'
  return spanParts(ms).join('\u00a0')
}

function spanParts(ms: number): string[] {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds === 0) return ['0', 'мин']
  if (seconds < 60) return [String(seconds), 'с']
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return [String(minutes), 'мин']
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes ? [String(hours), 'ч', String(restMinutes), 'мин'] : [String(hours), 'ч']
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? [String(days), 'д', String(restHours), 'ч'] : [String(days), 'д']
}
