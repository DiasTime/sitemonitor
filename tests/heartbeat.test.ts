import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_STALE_MINUTES,
  decideHeartbeat,
  dispatchPayload,
  staleAfterMinutes,
} from '../lib/heartbeat'

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

test('the threshold comes from HEARTBEAT_STALE_MINUTES, blank meaning unset', () => {
  assert.equal(staleAfterMinutes({}), DEFAULT_STALE_MINUTES)
  assert.equal(staleAfterMinutes({ HEARTBEAT_STALE_MINUTES: '' }), DEFAULT_STALE_MINUTES)
  assert.equal(staleAfterMinutes({ HEARTBEAT_STALE_MINUTES: '0' }), DEFAULT_STALE_MINUTES)
  assert.equal(staleAfterMinutes({ HEARTBEAT_STALE_MINUTES: '12' }), 12)
})

test('pinged every five minutes, the default leaves no hour of the day unchecked', () => {
  // The dashboard draws the last day as 24 one-hour bars, and a bar with no
  // check in it is grey. So the promise is about the longest gap between two
  // checks, not the average: it has to stay under an hour with room to spare
  // for a ping that is lost or a runner that is slow to start.
  const staleAfterMs = staleAfterMinutes({}) * 60_000
  const PING_MS = 5 * 60_000
  const DISPATCH_TO_CHECK_MS = 2 * 60_000

  let lastCheck = NOW
  let lastDispatchAt = 0
  let landing: number | null = null
  let longestGap = 0

  for (let now = NOW + 60_000; now <= NOW + 24 * 3600_000; now += PING_MS) {
    if (landing !== null && landing <= now) {
      longestGap = Math.max(longestGap, landing - lastCheck)
      lastCheck = landing
      landing = null
    }
    const decision = decideHeartbeat({
      lastCheck: new Date(lastCheck).toISOString(),
      staleAfterMs,
      lastDispatchAt,
      cooldownMs: COOLDOWN,
      now,
    })
    if (decision.shouldDispatch) {
      lastDispatchAt = now
      landing = now + DISPATCH_TO_CHECK_MS
    }
  }

  assert.ok(longestGap > 0, 'the simulation never started a run')
  assert.ok(
    longestGap <= 45 * 60_000,
    `longest gap was ${Math.round(longestGap / 60_000)} min — an hour bar would go grey`,
  )
})

test('a heartbeat run asks to be dropped if another run got there first', () => {
  // Every run the heartbeat starts is billed, so a second dispatch — another
  // Vercel instance, a second pinger — must not become a second check. The
  // workflow skips a run whose data is younger than min_gap_minutes; a run the
  // heartbeat really needed finds its data at least staleAfterMinutes old.
  assert.deepEqual(dispatchPayload(30), { source: 'heartbeat', min_gap_minutes: '15' })
  assert.equal(dispatchPayload(1).min_gap_minutes, '1')
  assert.ok(Number(dispatchPayload(30).min_gap_minutes) < 30)
})
