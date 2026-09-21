import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isReminderDue } from '../lib/reminders'
import type { Incident } from '../lib/types'

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0)
const SIX_HOURS = 6 * 3600_000
const ago = (hours: number) => new Date(NOW - hours * 3600_000).toISOString()

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 'i',
    monitorId: 'site',
    startedAt: ago(10),
    endedAt: null,
    durationMs: null,
    status: 'ongoing',
    statusCode: null,
    error: 'Connection timeout',
    failedChecks: 9,
    ...over,
  }
}

const due = (over: Partial<Incident>, intervalMs = SIX_HOURS) =>
  isReminderDue(incident(over), NOW, intervalMs)

test('an outage repeats once the interval has passed', () => {
  assert.equal(due({ lastNotifiedAt: ago(7) }), true)
  assert.equal(due({ lastNotifiedAt: ago(6) }), true, 'exactly on the interval counts')
})

test('an outage reported recently stays quiet', () => {
  assert.equal(due({ lastNotifiedAt: ago(5) }), false)
  assert.equal(due({ lastNotifiedAt: ago(0) }), false)
})

test('an incident from before reminders existed counts from when it opened', () => {
  assert.equal(due({ startedAt: ago(7), lastNotifiedAt: undefined }), true)
  assert.equal(due({ startedAt: ago(2), lastNotifiedAt: undefined }), false)
  assert.equal(due({ startedAt: ago(9), lastNotifiedAt: null }), true)
})

test('a closed incident is never repeated', () => {
  assert.equal(due({ status: 'resolved', lastNotifiedAt: ago(20) }), false)
})

test('an interval of zero switches reminders off', () => {
  assert.equal(due({ lastNotifiedAt: ago(40) }, 0), false)
})

test('a timestamp that cannot be read does not become a reminder loop', () => {
  assert.equal(due({ lastNotifiedAt: 'yesterday' }), false)
})

test('a timestamp in the future does not become a reminder loop', () => {
  // Clock skew or a hand-edited file must not fire on every run.
  assert.equal(due({ lastNotifiedAt: ago(-3) }), false)
})

test('a long outage keeps repeating on schedule', () => {
  assert.equal(due({ startedAt: ago(33), lastNotifiedAt: ago(27) }), true)
})
