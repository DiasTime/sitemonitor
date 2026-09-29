/**
 * The decision behind /api/heartbeat, kept apart from the request handling so
 * it can be exercised without a GitHub token: given when the last check was
 * recorded, should a ping start a run?
 */

import { numberFromEnv } from './env'

/**
 * How old the last recorded check may get before a ping starts a run.
 *
 * Thirty minutes, because the dashboard draws the day as one-hour bars and an
 * hour with no check in it is a grey bar. Pinged every five minutes, the
 * heartbeat starts a run 30–35 minutes after the previous check, which leaves
 * every hour covered even when a ping is lost or a runner is slow to start.
 * It is also well below the monitor's STALE_AFTER_MINUTES (90), so the repair
 * happens before the "monitoring gap" alert would fire: the alert is then what
 * you get when this endpoint was not pinged either, which is worth knowing.
 *
 * Keep COMMIT_INTERVAL_MINUTES (30 by default) at or below this. The age is
 * read from status.json, and a run that only buffers its results does not
 * move it — the next ping would see the old age and start another run.
 */
export const DEFAULT_STALE_MINUTES = 30

export function staleAfterMinutes(env: Record<string, string | undefined> = process.env): number {
  return numberFromEnv('HEARTBEAT_STALE_MINUTES', DEFAULT_STALE_MINUTES, env)
}

/**
 * The client payload of a heartbeat dispatch.
 *
 * `min_gap_minutes` lets the workflow's gate drop a run that arrives after
 * another run already made the check — a second pinger, a second Vercel
 * instance — for about a minute of runner time instead of a full check. Half
 * the threshold separates the two cases with room on both sides: a run the
 * heartbeat needed finds its data at least `staleMinutes` old, a duplicate
 * finds it a few minutes old.
 */
export function dispatchPayload(staleMinutes: number): { source: 'heartbeat'; min_gap_minutes: string } {
  return { source: 'heartbeat', min_gap_minutes: String(Math.max(1, Math.floor(staleMinutes / 2))) }
}

export interface HeartbeatInput {
  /** `updatedAt` from data/status.json — null or unparseable when unknown. */
  lastCheck: string | null | undefined
  /** How old that has to be to count as a gap. */
  staleAfterMs: number
  /** When this instance last started a run, 0 if never. */
  lastDispatchAt: number
  /** How long to leave a started run alone before starting another. */
  cooldownMs: number
  now: number
}

export interface HeartbeatDecision {
  lastCheck: string | null
  ageMinutes: number | null
  stale: boolean
  /** Stale, and not inside the cooldown of a run this instance just started. */
  shouldDispatch: boolean
}

export function decideHeartbeat(input: HeartbeatInput): HeartbeatDecision {
  const parsed = input.lastCheck ? new Date(input.lastCheck).getTime() : Number.NaN
  const known = Number.isFinite(parsed)

  // An unreadable timestamp is not evidence of freshness, so it counts as a
  // gap: a needless run costs a minute, a skipped one costs an unmonitored
  // hour.
  const ageMs = known ? input.now - parsed : Number.POSITIVE_INFINITY
  const stale = ageMs >= input.staleAfterMs
  const cooling = input.now - input.lastDispatchAt < input.cooldownMs

  return {
    lastCheck: known ? new Date(parsed).toISOString() : null,
    ageMinutes: known ? Math.round(ageMs / 60_000) : null,
    stale,
    shouldDispatch: stale && !cooling,
  }
}
