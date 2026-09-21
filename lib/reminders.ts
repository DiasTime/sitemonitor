import type { Incident } from './types'

/**
 * When to say it again.
 *
 * Alerts fire on transitions, which is right — nobody wants a message every
 * check while a site is down. But the silence that follows is total: an outage
 * that ran for 33 hours here produced exactly one message, at the moment it
 * started, and then nothing. Scrolled past at night, it was indistinguishable
 * from a quiet day.
 */
export function isReminderDue(
  incident: Pick<Incident, 'startedAt' | 'lastNotifiedAt' | 'status'>,
  now: number,
  intervalMs: number,
): boolean {
  if (intervalMs <= 0) return false
  if (incident.status !== 'ongoing') return false

  // Incidents opened before this existed have no lastNotifiedAt: the alert
  // that opened them is the notice to count from.
  const since = new Date(incident.lastNotifiedAt ?? incident.startedAt).getTime()
  if (!Number.isFinite(since)) return false

  // A timestamp in the future (clock skew, a hand-edited file) must not turn
  // into a reminder on every run.
  return now - since >= intervalMs
}
