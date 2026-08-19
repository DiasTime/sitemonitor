import { errorResponse, jsonResponse } from '@/lib/api'
import { dispatchRepositoryEvent } from '@/lib/github'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manual runs are cheap but not free — each one spends a GitHub Actions minute.
 * One every 30 seconds is plenty for a person clicking a button.
 */
const MIN_INTERVAL_MS = 30_000
let lastDispatchAt = 0

/**
 * POST /api/check — ask GitHub Actions to run a check now.
 *
 * The workflow does the actual probing, so a manual run behaves exactly like a
 * scheduled one: same checks, same incident handling, same Telegram alerts.
 * `loop_minutes: 0` makes it a single pass, so it finishes in well under a minute.
 */
export async function POST() {
  const now = Date.now()
  const waitMs = MIN_INTERVAL_MS - (now - lastDispatchAt)
  if (waitMs > 0) {
    return jsonResponse(
      { error: `A check was just started. Try again in ${Math.ceil(waitMs / 1000)}s.` },
      { status: 429 },
    )
  }

  try {
    await dispatchRepositoryEvent('run-check', { loop_minutes: '0' })
    lastDispatchAt = now
    return jsonResponse({ ok: true, startedAt: new Date(now).toISOString() }, { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
