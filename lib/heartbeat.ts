/**
 * The decision behind /api/heartbeat, kept apart from the request handling so
 * it can be exercised without a GitHub token: given when the last check was
 * recorded, should a ping start a run?
 */

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
