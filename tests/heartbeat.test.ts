import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decideHeartbeat } from '../lib/heartbeat'

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0)
const STALE_AFTER = 75 * 60_000
const COOLDOWN = 5 * 60_000
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const decide = (
  lastCheck: string | null,
  over: { lastDispatchAt?: number; staleAfterMs?: number } = {},
) =>
  decideHeartbeat({
    lastCheck,
    staleAfterMs: over.staleAfterMs ?? STALE_AFTER,
    lastDispatchAt: over.lastDispatchAt ?? 0,
    cooldownMs: COOLDOWN,
    now: NOW,
  })

test('fresh data starts nothing', () => {
  const decision = decide(minutesAgo(20))
  assert.equal(decision.stale, false)
  assert.equal(decision.shouldDispatch, false)
  assert.equal(decision.ageMinutes, 20)
})

test('the threshold is where a run becomes due', () => {
  assert.equal(decide(minutesAgo(74)).shouldDispatch, false)
  assert.equal(decide(minutesAgo(75)).shouldDispatch, true)
})

test('a real gap starts a run', () => {
  const decision = decide(minutesAgo(240))
  assert.equal(decision.stale, true)
  assert.equal(decision.shouldDispatch, true)
  assert.equal(decision.ageMinutes, 240)
})

test('a run just started is given time to finish', () => {
  // status.json only moves once the run commits, so without a cooldown every
  // ping in that first minute would start another run.
  assert.equal(decide(minutesAgo(240), { lastDispatchAt: NOW - 2 * 60_000 }).shouldDispatch, false)
  assert.equal(decide(minutesAgo(240), { lastDispatchAt: NOW - 6 * 60_000 }).shouldDispatch, true)
})

test('data that cannot be read counts as stale', () => {
  // A needless run costs a minute; a skipped one costs an unmonitored hour.
  for (const value of [null, 'soon']) {
    const decision = decide(value)
    assert.equal(decision.shouldDispatch, true)
    assert.equal(decision.ageMinutes, null)
    assert.equal(decision.lastCheck, null)
  }
})

test('a timestamp from the future is not a gap', () => {
  assert.equal(decide(minutesAgo(-30)).shouldDispatch, false)
})
