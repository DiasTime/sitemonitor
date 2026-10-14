import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildReport,
  formatAvailability,
  formatSpan,
  incidentCause,
  isTimeZone,
  reportUnit,
  startOfZonedDay,
  zoneOffsetMs,
  type BuildReportInput,
} from '../lib/report'
import type { HistoryEntry, Incident, Monitor } from '../lib/types'

const HOUR = 3600_000
const DAY = 24 * HOUR
const ALMATY = 'Asia/Almaty'

// 1-11 September 2026 in Almaty (UTC+5): local midnights.
const FROM = Date.UTC(2026, 7, 31, 19)
const TO = FROM + 10 * DAY
const NOW = TO + 5 * DAY
const at = (hours: number) => new Date(FROM + hours * HOUR).toISOString()

const site: Monitor = { id: 'site', name: 'Site', url: 'https://site.kz/login', enabled: true }
const api: Monitor = { id: 'api', name: 'API', url: 'https://api.kz', enabled: true, type: 'health' }

function incident(over: Partial<Incident> & Pick<Incident, 'startedAt'>): Incident {
  const endedAt = over.endedAt === undefined ? null : over.endedAt
  return {
    id: `${over.monitorId ?? 'site'}-${over.startedAt}`,
    monitorId: 'site',
    endedAt,
    durationMs: endedAt ? Date.parse(endedAt) - Date.parse(over.startedAt) : null,
    status: endedAt ? 'resolved' : 'ongoing',
    statusCode: 502,
    error: 'HTTP 502',
    failedChecks: 2,
    ...over,
  }
}

function entry(hours: number, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: at(hours),
    monitorId: 'site',
    status: 'UP',
    statusCode: 200,
    responseTime: 100,
    error: null,
    ...over,
  }
}

function build(over: Partial<BuildReportInput> = {}) {
  return buildReport({
    monitors: [site, api],
    incidents: [],
    history: [],
    from: FROM,
    to: TO,
    now: NOW,
    timeZone: ALMATY,
    ...over,
  })
}

test('a quiet period is 100% available with no incidents', () => {
  const report = build()
  assert.equal(report.totals.incidents, 0)
  assert.equal(report.totals.availability, 100)
  assert.equal(report.totals.mttrMs, null)
  assert.equal(report.totals.longest, null)
  assert.equal(report.incidents.length, 0)
  assert.equal(report.causes.length, 0)
})

test('downtime is measured in time and clipped to the period', () => {
  const report = build({
    incidents: [
      // Began two hours before the period: only the last two hours count.
      incident({ startedAt: at(-2), endedAt: at(2) }),
      incident({ startedAt: at(24), endedAt: at(30) }),
      // Overlaps nothing.
      incident({ startedAt: at(-50), endedAt: at(-40) }),
    ],
  })
  const row = report.monitors.find((monitor) => monitor.id === 'site')!
  assert.equal(row.incidents, 2)
  assert.equal(row.downtimeMs, 8 * HOUR)
  assert.equal(row.longestMs, 6 * HOUR)
  assert.equal(row.availability, 100 * (1 - (8 * HOUR) / (10 * DAY)))
  // The log keeps each outage whole.
  assert.deepEqual(report.incidents.map((item) => item.durationMs), [4 * HOUR, 6 * HOUR])
  assert.equal(report.totals.mttrMs, 4 * HOUR)
  assert.deepEqual(report.totals.longest, { monitorName: 'Site', durationMs: 6 * HOUR })
})

test('an ongoing incident runs until now, and the period ends no later than now', () => {
  const now = FROM + 5 * DAY
  const report = build({
    now,
    incidents: [incident({ startedAt: at(4 * 24), endedAt: null })],
  })
  assert.equal(report.to, new Date(now).toISOString())
  const row = report.monitors.find((monitor) => monitor.id === 'site')!
  assert.equal(row.downtimeMs, DAY)
  assert.equal(row.availability, 80)
  assert.equal(report.incidents[0].endedAt, null)
  assert.equal(report.incidents[0].durationMs, DAY)
})

test('a monitor added mid-period is measured from its creation', () => {
  const late: Monitor = { ...api, createdAt: at(5 * 24) }
  const report = build({
    monitors: [site, late],
    incidents: [incident({ monitorId: 'api', startedAt: at(6 * 24), endedAt: at(6 * 24 + 12) })],
  })
  const row = report.monitors.find((monitor) => monitor.id === 'api')!
  assert.equal(row.availability, 90)
  // Both monitors weigh by the time they were watched: 12 h down of 15 days.
  assert.equal(report.totals.availability, 100 * (1 - (12 * HOUR) / (15 * DAY)))
})

test('the worst monitor comes first', () => {
  const report = build({
    incidents: [
      incident({ monitorId: 'api', startedAt: at(1), endedAt: at(3) }),
      incident({ monitorId: 'site', startedAt: at(1), endedAt: at(2) }),
    ],
  })
  assert.deepEqual(report.monitors.map((monitor) => monitor.id), ['api', 'site'])
  assert.equal(report.totals.affected, 2)
})

test('a single-monitor report leaves the others out', () => {
  const report = build({
    monitorId: 'api',
    incidents: [
      incident({ monitorId: 'api', startedAt: at(1), endedAt: at(3) }),
      incident({ monitorId: 'site', startedAt: at(1), endedAt: at(2) }),
    ],
  })
  assert.equal(report.monitorId, 'api')
  assert.deepEqual(report.monitors.map((monitor) => monitor.id), ['api'])
  assert.deepEqual(report.incidents.map((item) => item.monitorName), ['API'])
})

test('checks and response times come from history inside the period', () => {
  const report = build({
    history: [
      entry(-1),
      entry(1, { responseTime: 200 }),
      entry(2, { responseTime: 400 }),
      entry(3, { status: 'DOWN', statusCode: 502, responseTime: 9000 }),
    ],
  })
  const row = report.monitors.find((monitor) => monitor.id === 'site')!
  assert.equal(row.checks, 3)
  assert.equal(row.failedChecks, 1)
  assert.equal(row.avgResponseMs, 300)
  assert.equal(report.historyFrom, at(-1))
  assert.equal(report.monitors.find((monitor) => monitor.id === 'api')!.avgResponseMs, null)
})

test('day buckets follow local midnights and add up to the incident count', () => {
  const report = build({
    incidents: [
      incident({ startedAt: at(-3), endedAt: at(1) }),
      incident({ startedAt: at(23), endedAt: at(25) }),
      incident({ monitorId: 'api', startedAt: at(9 * 24 + 1), endedAt: at(9 * 24 + 2) }),
    ],
  })
  assert.equal(report.unit, 'day')
  assert.equal(report.buckets.length, 10)
  assert.equal(report.buckets[0].start, new Date(FROM).toISOString())
  assert.deepEqual(
    report.buckets.map((bucket) => bucket.incidents),
    [2, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  )
  assert.equal(report.buckets[0].downtimeMs, 2 * HOUR)
  assert.equal(report.buckets[1].downtimeMs, HOUR)
  const total = report.buckets.reduce((sum, bucket) => sum + bucket.incidents, 0)
  assert.equal(total, report.totals.incidents)
})

test('the bucket size grows with the period', () => {
  assert.equal(reportUnit(DAY), 'hour')
  assert.equal(reportUnit(2 * DAY), 'hour')
  assert.equal(reportUnit(3 * DAY), 'day')
  assert.equal(reportUnit(62 * DAY), 'day')
  assert.equal(reportUnit(90 * DAY), 'week')
  assert.equal(build({ to: FROM + DAY }).buckets.length, 24)
  assert.equal(build({ to: FROM + 70 * DAY, now: FROM + 80 * DAY }).buckets.length, 10)
})

test('time zones: offsets, local midnights and DST days', () => {
  assert.equal(isTimeZone(ALMATY), true)
  assert.equal(isTimeZone('Mars/Olympus'), false)
  assert.equal(isTimeZone(''), false)
  assert.equal(zoneOffsetMs(FROM, ALMATY), 5 * HOUR)
  assert.equal(startOfZonedDay(FROM + 13 * HOUR, ALMATY), FROM)
  // Berlin springs forward on 29 March 2026: that day starts at 23:00 UTC the day before.
  const berlinDay = Date.UTC(2026, 2, 28, 23)
  assert.equal(startOfZonedDay(Date.UTC(2026, 2, 29, 12), 'Europe/Berlin'), berlinDay)
  const week = buildReport({
    monitors: [site],
    incidents: [],
    history: [],
    from: berlinDay,
    to: berlinDay + 3 * DAY,
    now: berlinDay + 4 * DAY,
    timeZone: 'Europe/Berlin',
  })
  assert.equal(week.buckets[1].start, new Date(Date.UTC(2026, 2, 29, 22)).toISOString())
})

test('causes: old English wording groups with the current Russian one', () => {
  assert.equal(incidentCause({ error: 'Connection timeout', statusCode: null }), 'Таймаут соединения')
  assert.equal(incidentCause({ error: null, statusCode: 503 }), 'HTTP 503')
  const report = build({
    incidents: [
      incident({ startedAt: at(1), endedAt: at(2), error: 'Connection timeout', statusCode: null }),
      incident({ startedAt: at(3), endedAt: at(5), error: 'Таймаут соединения', statusCode: null }),
      incident({ startedAt: at(6), endedAt: at(7) }),
    ],
  })
  assert.deepEqual(report.causes, [
    { cause: 'Таймаут соединения', incidents: 2, downtimeMs: 3 * HOUR },
    { cause: 'HTTP 502', incidents: 1, downtimeMs: HOUR },
  ])
})

test('availability never rounds up to 100% while there was downtime', () => {
  assert.equal(formatAvailability(100), '100%')
  assert.equal(formatAvailability(99.9999), '99,99%')
  assert.equal(formatAvailability(87.946), '87,94%')
  assert.equal(formatAvailability(null), '—')
})

test('durations are short and never split across lines', () => {
  assert.equal(formatSpan(0), '0 мин')
  assert.equal(formatSpan(45_000), '45 с')
  assert.equal(formatSpan(12 * 60_000), '12 мин')
  assert.equal(formatSpan(3 * HOUR + 5 * 60_000), '3 ч 5 мин')
  assert.equal(formatSpan(2 * DAY + 4 * HOUR), '2 д 4 ч')
  assert.equal(formatSpan(null), '—')
})
