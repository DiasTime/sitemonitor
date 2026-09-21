import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyResults } from '../lib/transitions'
import type { CheckResult, HistoryEntry, Incident, Monitor, MonitorStatus } from '../lib/types'

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0)
const AT = new Date(NOW).toISOString()
const ago = (hours: number) => new Date(NOW - hours * 3600_000).toISOString()

const site: Monitor = {
  id: 'site',
  name: 'Site',
  url: 'https://example.kz',
  enabled: true,
}

function result(over: Partial<CheckResult> = {}): CheckResult {
  return {
    monitorId: 'site',
    status: 'UP',
    statusCode: 200,
    responseTime: 120,
    error: null,
    timestamp: AT,
    reported: null,
    ...over,
  }
}

function status(over: Partial<MonitorStatus> = {}): MonitorStatus {
  return {
    id: 'site',
    status: 'UP',
    statusCode: 200,
    responseTime: 100,
    error: null,
    lastCheck: ago(1),
    since: ago(48),
    totalChecks: 10,
    totalUp: 10,
    uptime24h: 100,
    uptime7d: 100,
    uptime30d: 100,
    avgResponse24h: 100,
    incidents: 0,
    reported: null,
    ...over,
  }
}

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: AT,
    monitorId: 'site',
    status: 'UP',
    statusCode: 200,
    responseTime: 120,
    error: null,
    ...over,
  }
}

function run(over: {
  monitors?: Monitor[]
  results?: CheckResult[]
  previousStatus?: Record<string, MonitorStatus>
  incidents?: Incident[]
  newEntries?: HistoryEntry[]
  reminderIntervalMs?: number
} = {}) {
  const incidents = over.incidents ?? []
  const outcome = applyResults({
    monitors: over.monitors ?? [site],
    results: over.results ?? [result()],
    previousStatus: over.previousStatus ?? {},
    incidents,
    newEntries: over.newEntries ?? [entry()],
    timestamp: AT,
    now: NOW,
    reminderIntervalMs: over.reminderIntervalMs ?? 6 * 3600_000,
  })
  return { ...outcome, incidents }
}

test('a healthy site that stays healthy is not news', () => {
  const outcome = run({ previousStatus: { site: status() } })

  assert.equal(outcome.statusChanged, false)
  assert.deepEqual(outcome.transitions, [])
  assert.deepEqual(outcome.reminders, [])
  assert.deepEqual(outcome.incidents, [])
  // `since` survives: the site has been up since long before this run.
  assert.equal(outcome.nextStatus.site.since, ago(48))
})

test('going down opens an incident and alerts once', () => {
  const outcome = run({
    previousStatus: { site: status() },
    results: [result({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
    newEntries: [entry({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
  })

  assert.equal(outcome.statusChanged, true)
  assert.equal(outcome.transitions.length, 1)
  assert.equal(outcome.transitions[0].kind, 'down')
  assert.equal(outcome.incidents.length, 1)

  const incident = outcome.incidents[0]
  assert.equal(incident.status, 'ongoing')
  assert.equal(incident.startedAt, AT)
  assert.equal(incident.failedChecks, 1)
  // The opening alert counts as the notice reminders are measured from.
  assert.equal(incident.lastNotifiedAt, AT)
  assert.equal(outcome.nextStatus.site.since, AT)
})

test('the very first check failing still opens an incident', () => {
  const outcome = run({
    previousStatus: {},
    results: [result({ status: 'DOWN', statusCode: 503, error: 'HTTP 503' })],
    newEntries: [entry({ status: 'DOWN', statusCode: 503, error: 'HTTP 503' })],
  })

  assert.equal(outcome.statusChanged, true)
  assert.equal(outcome.transitions[0].kind, 'down')
  assert.equal(outcome.incidents.length, 1)
  assert.equal(outcome.incidents[0].statusCode, 503)
})

test('recovering closes the incident and measures the outage', () => {
  const open: Incident = {
    id: 'i', monitorId: 'site', startedAt: ago(3), endedAt: null, durationMs: null,
    status: 'ongoing', statusCode: null, error: 'Connection timeout', failedChecks: 3,
    lastNotifiedAt: ago(3),
  }
  const outcome = run({
    previousStatus: { site: status({ status: 'DOWN', since: ago(3) }) },
    incidents: [open],
    results: [result()],
  })

  assert.equal(outcome.transitions[0].kind, 'recovered')
  assert.equal(outcome.transitions[0].downtimeMs, 3 * 3600_000)
  assert.equal(open.status, 'resolved')
  assert.equal(open.endedAt, AT)
  assert.equal(open.durationMs, 3 * 3600_000)
})

test('recovering without a matching incident falls back to `since`', () => {
  const outcome = run({
    previousStatus: { site: status({ status: 'DOWN', since: ago(2) }) },
    incidents: [],
    results: [result()],
  })

  assert.equal(outcome.transitions[0].kind, 'recovered')
  assert.equal(outcome.transitions[0].downtimeMs, 2 * 3600_000)
})

test('an outage still going is repeated once the interval has passed', () => {
  const open: Incident = {
    id: 'i', monitorId: 'site', startedAt: ago(9), endedAt: null, durationMs: null,
    status: 'ongoing', statusCode: null, error: 'Connection timeout', failedChecks: 8,
    lastNotifiedAt: ago(7),
  }
  const outcome = run({
    previousStatus: { site: status({ status: 'DOWN', since: ago(9) }) },
    incidents: [open],
    results: [result({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
    newEntries: [entry({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
  })

  assert.equal(outcome.statusChanged, false, 'still down is not a state change')
  assert.deepEqual(outcome.transitions, [])
  assert.equal(outcome.reminders.length, 1)
  assert.equal(outcome.reminders[0].downtimeMs, 9 * 3600_000)
  assert.equal(open.lastNotifiedAt, AT, 'marked as told, so it is not repeated next run')
  assert.equal(open.failedChecks, 9, 'the failure is counted')
})

test('an outage reported recently stays quiet', () => {
  const open: Incident = {
    id: 'i', monitorId: 'site', startedAt: ago(9), endedAt: null, durationMs: null,
    status: 'ongoing', statusCode: null, error: 'Connection timeout', failedChecks: 8,
    lastNotifiedAt: ago(1),
  }
  const outcome = run({
    previousStatus: { site: status({ status: 'DOWN', since: ago(9) }) },
    incidents: [open],
    results: [result({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
    newEntries: [entry({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
  })

  assert.deepEqual(outcome.reminders, [])
  assert.equal(open.lastNotifiedAt, ago(1), 'left alone, so the interval keeps running')
})

test('reminders can be switched off entirely', () => {
  const open: Incident = {
    id: 'i', monitorId: 'site', startedAt: ago(40), endedAt: null, durationMs: null,
    status: 'ongoing', statusCode: null, error: 'Connection timeout', failedChecks: 30,
    lastNotifiedAt: ago(40),
  }
  const outcome = run({
    previousStatus: { site: status({ status: 'DOWN', since: ago(40) }) },
    incidents: [open],
    results: [result({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
    newEntries: [entry({ status: 'DOWN', statusCode: null, error: 'Connection timeout' })],
    reminderIntervalMs: 0,
  })

  assert.deepEqual(outcome.reminders, [])
})

test('a monitor that was not checked keeps its last known state', () => {
  const disabled: Monitor = { ...site, id: 'off', name: 'Off', enabled: false }
  const previous = status({ id: 'off', status: 'DOWN', since: ago(5) })

  const outcome = run({
    monitors: [site, disabled],
    previousStatus: { site: status(), off: previous },
    results: [result()],
  })

  assert.deepEqual(outcome.nextStatus.off, previous)
  assert.equal(outcome.statusChanged, false)
})

test('a monitor with no history at all does not invent one', () => {
  const outcome = run({
    monitors: [{ ...site, id: 'fresh', name: 'Fresh' }],
    previousStatus: {},
    results: [result({ monitorId: 'fresh' })],
    newEntries: [entry({ monitorId: 'fresh' })],
  })

  assert.equal(outcome.statusChanged, true, 'first sighting counts as a change')
  assert.deepEqual(outcome.transitions, [], 'but an UP first sighting is not an alert')
  assert.equal(outcome.nextStatus.fresh.since, AT)
  assert.equal(outcome.nextStatus.fresh.totalChecks, 1)
})

test('checks buffered between commits are all counted', () => {
  // Three samples reached this run: two buffered, one just taken.
  const outcome = run({
    previousStatus: { site: status({ totalChecks: 10, totalUp: 8 }) },
    newEntries: [entry(), entry({ status: 'DOWN', error: 'blip' }), entry()],
  })

  assert.equal(outcome.nextStatus.site.totalChecks, 13)
  assert.equal(outcome.nextStatus.site.totalUp, 10)
})

test('one monitor going down does not disturb the others', () => {
  const other: Monitor = { ...site, id: 'other', name: 'Other', url: 'https://other.kz' }

  const outcome = run({
    monitors: [site, other],
    previousStatus: { site: status(), other: status({ id: 'other' }) },
    results: [
      result({ status: 'DOWN', statusCode: null, error: 'Connection timeout' }),
      result({ monitorId: 'other' }),
    ],
    newEntries: [
      entry({ status: 'DOWN', statusCode: null, error: 'Connection timeout' }),
      entry({ monitorId: 'other' }),
    ],
  })

  assert.equal(outcome.transitions.length, 1)
  assert.equal(outcome.transitions[0].monitor.id, 'site')
  assert.equal(outcome.incidents.length, 1)
  assert.equal(outcome.incidents[0].monitorId, 'site')
  assert.equal(outcome.nextStatus.other.status, 'UP')
})
