import { errorResponse, jsonResponse } from '@/lib/api'
import { dispatchRepositoryEvent } from '@/lib/github'
import { decideHeartbeat, dispatchPayload, staleAfterMinutes } from '@/lib/heartbeat'
import { getStatus } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so on a plan whose
 * crons may run every few minutes, setting CRON_SECRET to the same value as
 * HEARTBEAT_TOKEN is all it takes to point one at this endpoint.
 */
function authorized(request: Request): boolean {
  const expected = process.env.HEARTBEAT_TOKEN
  if (!expected) return true

  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const provided = header || new URL(request.url).searchParams.get('token') || ''
  return provided === expected
}

/**
 * GET/POST /api/heartbeat — the clock the monitor runs on.
 *
 * GitHub's scheduler cannot be that clock. Since 26 Aug 2026 it serves about
 * one tick in ten on this repository — 5–8 runs a day out of 72 asked for,
 * hours late or never — while a dispatched run starts within seconds. And a
 * monitor that is not running cannot notice that it is not running, so the
 * timing has to come from somewhere that is always awake. Point a punctual
 * outside scheduler at this — cron-job.org, an uptime service, a GitLab
 * pipeline schedule, Vercel Cron on Pro — every five minutes.
 *
 * Pinging often is cheap on purpose: a run is started only when the data is
 * actually stale, so a ping every five minutes costs a run every half hour,
 * not 288 runs a day.
 */
async function handle(request: Request) {
  if (!authorized(request)) {
    return jsonResponse({ error: 'Invalid heartbeat token' }, { status: 401 })
  }

  try {
    const staleMinutes = staleAfterMinutes()
    const status = await getStatus()
    const { shouldDispatch, ...decision } = decideHeartbeat({
      lastCheck: status.updatedAt,
      staleAfterMs: staleMinutes * 60_000,
      lastDispatchAt,
      cooldownMs: DISPATCH_COOLDOWN_MS,
      now: Date.now(),
    })
    const report = { ...decision, staleAfterMinutes: staleMinutes }

    if (!shouldDispatch) return jsonResponse({ ...report, triggered: false })

    await dispatchRepositoryEvent('run-check', dispatchPayload(staleMinutes))
    lastDispatchAt = Date.now()
    return jsonResponse({ ...report, triggered: true }, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}

export const GET = handle
export const POST = handle
