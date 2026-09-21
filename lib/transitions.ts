import { isReminderDue } from './reminders'
import type { CheckResult, HistoryEntry, Incident, Monitor, MonitorStatus } from './types'

/**
 * What a run makes of its probes: which monitors changed state, which outages
 * opened or closed, and which ongoing ones are due to be repeated.
 *
 * This is the judgement at the centre of the tool — everything else reads a
 * file, sends a message or commits. It lives apart from the script so it can
 * be exercised without network, credentials or a clock: give it probe results
 * and the previous state, and it tells you what follows.
 */

export interface Transition {
  monitor: Monitor
  result: CheckResult
  kind: 'down' | 'recovered'
  downtimeMs?: number
}

export interface Reminder {
  monitor: Monitor
  incident: Incident
  downtimeMs: number
}

export interface TransitionInput {
  /** Every configured monitor, including the disabled ones. */
  monitors: Monitor[]
  /** Results of this run's probes, one per checked monitor. */
  results: CheckResult[]
  /** status.json as it was read. */
  previousStatus: Record<string, MonitorStatus>
  /**
   * Incidents as they were read. Mutated in place: outages are opened, closed
   * and marked as reported on these objects, which is what the caller then
   * writes back.
   */
  incidents: Incident[]
  /** Samples since the last commit — buffered runs plus this one. */
  newEntries: HistoryEntry[]
  /** This run's timestamp, shared by every sample it records. */
  timestamp: string
  /** The same instant in milliseconds, for arithmetic. */
  now: number
  /** How often an ongoing outage repeats itself; 0 disables reminders. */
  reminderIntervalMs: number
}

export interface TransitionOutcome {
  nextStatus: Record<string, MonitorStatus>
  /** State changes worth an immediate message. */
  transitions: Transition[]
  /** Outages that have gone quiet for too long. */
  reminders: Reminder[]
  /** Whether any monitor changed state — the strongest reason to commit. */
  statusChanged: boolean
}

/** The most recent still-open incident for a monitor, if any. */
function ongoingFor(incidents: Incident[], monitorId: string): Incident | undefined {
  for (let index = incidents.length - 1; index >= 0; index -= 1) {
    const incident = incidents[index]
    if (incident.monitorId === monitorId && incident.status === 'ongoing') return incident
  }
  return undefined
}

function openIncident(monitor: Monitor, result: CheckResult): Incident {
  return {
    id: `${monitor.id}-${result.timestamp}`,
    monitorId: monitor.id,
    startedAt: result.timestamp,
    endedAt: null,
    durationMs: null,
    status: 'ongoing',
    statusCode: result.statusCode,
    error: result.error,
    failedChecks: 1,
    lastNotifiedAt: result.timestamp,
  }
}

export function applyResults(input: TransitionInput): TransitionOutcome {
  const { incidents, previousStatus, timestamp, now } = input
  const resultById = new Map(input.results.map((result) => [result.monitorId, result]))

  const nextStatus: Record<string, MonitorStatus> = {}
  const transitions: Transition[] = []
  const reminders: Reminder[] = []
  let statusChanged = false

  for (const monitor of input.monitors) {
    const previous = previousStatus[monitor.id]
    const result = resultById.get(monitor.id)

    // Disabled monitors keep their last known state untouched.
    if (!result) {
      if (previous) nextStatus[monitor.id] = previous
      continue
    }

    const sinceLastCommit = input.newEntries.filter((entry) => entry.monitorId === monitor.id)
    const upCount = sinceLastCommit.filter((entry) => entry.status === 'UP').length
    const downCount = sinceLastCommit.filter((entry) => entry.status === 'DOWN').length

    const changed = !previous || previous.status !== result.status
    if (changed) statusChanged = true

    if (previous && changed) {
      if (result.status === 'DOWN') {
        incidents.push(openIncident(monitor, result))
        transitions.push({ monitor, result, kind: 'down' })
      } else {
        const ongoing = ongoingFor(incidents, monitor.id)
        // Without an incident to close — one lost to a hand-edited file, say —
        // the previous state's `since` is the best record of when it started.
        const startedAt = ongoing
          ? new Date(ongoing.startedAt).getTime()
          : new Date(previous.since).getTime()
        const downtimeMs = Math.max(0, new Date(result.timestamp).getTime() - startedAt)
        if (ongoing) {
          ongoing.endedAt = result.timestamp
          ongoing.durationMs = downtimeMs
          ongoing.status = 'resolved'
          ongoing.failedChecks += downCount
        }
        transitions.push({ monitor, result, kind: 'recovered', downtimeMs })
      }
    } else if (previous && result.status === 'DOWN') {
      // Still down — keep counting failures, and speak up again only once the
      // reminder interval has passed, so a long outage does not go silent.
      const ongoing = ongoingFor(incidents, monitor.id)
      if (ongoing) {
        ongoing.failedChecks += downCount

        if (isReminderDue(ongoing, now, input.reminderIntervalMs)) {
          // Marked as told before the message goes out: a Telegram outage must
          // not turn into a reminder on every run once it comes back.
          ongoing.lastNotifiedAt = timestamp
          reminders.push({
            monitor,
            incident: ongoing,
            downtimeMs: Math.max(0, now - new Date(ongoing.startedAt).getTime()),
          })
        }
      }
    } else if (!previous && result.status === 'DOWN') {
      // First ever check already fails: open an incident and alert once.
      incidents.push(openIncident(monitor, result))
      transitions.push({ monitor, result, kind: 'down' })
    }

    nextStatus[monitor.id] = {
      id: monitor.id,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error,
      lastCheck: result.timestamp,
      since: changed ? result.timestamp : (previous?.since ?? result.timestamp),
      totalChecks: (previous?.totalChecks ?? 0) + sinceLastCommit.length,
      totalUp: (previous?.totalUp ?? 0) + upCount,
      uptime24h: null,
      uptime7d: null,
      uptime30d: null,
      avgResponse24h: null,
      incidents: 0,
      reported: result.reported,
    }
  }

  return { nextStatus, transitions, reminders, statusChanged }
}
