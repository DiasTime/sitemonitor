import { errorResponse, jsonResponse } from '@/lib/api'
import { dispatchRepositoryEvent } from '@/lib/github'
import { decideHeartbeat } from '@/lib/heartbeat'
import { getStatus } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * How old the last recorded check has to be before a ping starts a run.
 *
 * Below the monitor's own STALE_AFTER_MINUTES (90), so the repair happens
 * before the "monitoring gap" alert would fire: the alert is then what you get
 * when this endpoint was not pinged either, which is worth knowing.
 */
function staleAfterMs(): number {
  const minutes = Number(process.env.HEARTBEAT_STALE_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 75) * 60_000
}

/**
 * Do not start a second run while the first is still getting to its commit.
 * A run needs about a minute before status.json moves, and until it does every
 * ping still sees the old timestamp.
 */
const DISPATCH_COOLDOWN_MS = 5 * 60_000
let lastDispatchAt = 0

/**
 * Optional shared secret. Unset leaves the endpoint open, which is defensible:
 * it reveals only how long ago the last check ran, and it cannot start more
 * than one run per cooldown no matter how often it is called.
 */
function authorized(request: Request): boolean {
  const expected = process.env.HEARTBEAT_TOKEN
  if (!expected) return true

  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const provided = header || new URL(request.url).searchParams.get('token') || ''
  return provided === expected
}

/**
 * GET/POST /api/heartbeat — an outside clock for a schedule that drops ticks.
 *
 * GitHub's scheduler serves roughly half of what this repository asks for, and
 * a monitor that is not running cannot notice that it is not running: the gap
 * is only ever discovered by the run that ends it. So the discovery has to
 * happen somewhere that is always awake. Point anything that can fetch a URL
 * at this — an uptime service, a GitLab pipeline schedule, a cron box — and a
 * missed hour is repaired on the next ping instead of waiting for GitHub.
 *
 * Pinging often is cheap on purpose: a run is started only when the data is
 * actually stale, so a ping every five minutes costs 24 runs a day, not 288.
 */
async function handle(request: Request) {
  if (!authorized(request)) {
    return jsonResponse({ error: 'Invalid heartbeat token' }, { status: 401 })
  }

  try {
    const status = await getStatus()
    const { shouldDispatch, ...decision } = decideHeartbeat({
      lastCheck: status.updatedAt,
      staleAfterMs: staleAfterMs(),
      lastDispatchAt,
      cooldownMs: DISPATCH_COOLDOWN_MS,
      now: Date.now(),
    })

    if (!shouldDispatch) return jsonResponse({ ...decision, triggered: false })

    await dispatchRepositoryEvent('run-check')
    lastDispatchAt = Date.now()
    return jsonResponse({ ...decision, triggered: true }, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}

export const GET = handle
export const POST = handle
