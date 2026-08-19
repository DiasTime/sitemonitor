/**
 * Site Monitor — the entire monitoring backend.
 *
 * Runs inside GitHub Actions roughly every three minutes:
 *
 *   read data/monitors.json
 *     -> probe every enabled site over HTTP(S)
 *     -> update status / history / incidents
 *     -> notify Telegram on the *transitions* only (UP -> DOWN, DOWN -> UP)
 *     -> write the JSON files back, but only when it is worth a commit
 *
 * There is no database and no server: the repository holds the state and this
 * script is the only writer during a run (the workflow's concurrency group keeps
 * runs from overlapping).
 */

import { promises as dns } from 'node:dns'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isBlockedAddress, isBlockedHostname, validateMonitorUrl } from '../lib/security'
import type {
  CheckResult,
  HealthResult,
  HistoryEntry,
  HistoryFile,
  Incident,
  IncidentsFile,
  Monitor,
  MonitorStatus,
  MonitorsFile,
  ProbeResult,
  StatusFile,
} from '../lib/types'
import {
  formatDuration,
  formatFullTimestamp,
  formatResponseTime,
  hostnameOf,
} from '../lib/utils'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PATHS = {
  monitors: path.join(ROOT, 'data/monitors.json'),
  status: path.join(ROOT, 'data/status.json'),
  history: path.join(ROOT, 'data/history.json'),
  incidents: path.join(ROOT, 'data/incidents.json'),
  buffer: path.join(ROOT, '.monitor-cache/pending-history.json'),
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = numberFromEnv('CHECK_TIMEOUT_MS', 10_000)
/** How many sites are probed at the same time. */
const CONCURRENCY = numberFromEnv('CHECK_CONCURRENCY', 8)
/** History older than this is dropped on every run. */
const HISTORY_RETENTION_DAYS = numberFromEnv('HISTORY_RETENTION_DAYS', 30)
/** Hard cap so history.json cannot grow without bound. */
const HISTORY_MAX_ENTRIES = numberFromEnv('HISTORY_MAX_ENTRIES', 200_000)
/**
 * When nothing changed, results are still buffered but committed at most this
 * often, so the git log stays a record of outages rather than of every check.
 */
const COMMIT_INTERVAL_MINUTES = numberFromEnv('COMMIT_INTERVAL_MINUTES', 30)
/** Safety valve for the between-commits buffer. */
const BUFFER_MAX_ENTRIES = numberFromEnv('BUFFER_MAX_ENTRIES', 5_000)

const USER_AGENT =
  process.env.CHECK_USER_AGENT || 'SiteMonitor/1.0 (+https://github.com/topics/uptime-monitoring)'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(message: string) {
  process.stdout.write(`${message}\n`)
}

async function readJson<T>(file: string, fallback: T): Promise<{ data: T; existed: boolean }> {
  try {
    const text = await fs.readFile(file, 'utf8')
    return { data: JSON.parse(text) as T, existed: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { data: fallback, existed: false }
    throw new Error(`${path.relative(ROOT, file)} could not be read: ${(error as Error).message}`)
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Publish a key=value pair for later workflow steps. */
async function setOutput(key: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  await fs.appendFile(file, `${key}=${value}\n`, 'utf8')
}

/** Run `worker` over `items` with a bounded number of parallel calls. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(runners)
  return results
}

// ---------------------------------------------------------------------------
// HTTP probing (with SSRF protection)
// ---------------------------------------------------------------------------

/** Human-readable message for a Node network/TLS error. */
function describeError(error: NodeJS.ErrnoException): string {
  const code = error.code || ''
  switch (code) {
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      return 'Connection timeout'
    case 'ENOTFOUND':
      return 'DNS error: host not found'
    case 'EAI_AGAIN':
      return 'DNS error: lookup failed'
    case 'ECONNREFUSED':
      return 'Connection refused'
    case 'ECONNRESET':
      return 'Connection reset by peer'
    case 'EHOSTUNREACH':
      return 'Host unreachable'
    case 'ENETUNREACH':
      return 'Network unreachable'
    case 'EPROTO':
    case 'EPIPE':
      return 'Connection error'
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'SSL error: certificate does not match hostname'
    case 'CERT_HAS_EXPIRED':
      return 'SSL error: certificate has expired'
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'SSL error: self-signed certificate'
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'SSL error: certificate could not be verified'
    default:
      if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || code.includes('CERT')) {
        return `SSL error: ${code}`
      }
      return code ? `${code}: ${error.message}` : error.message || 'Request failed'
  }
}

/**
 * DNS resolver that refuses to hand back private, loopback or link-local
 * addresses. Passing it to `http.request` as `lookup` means the socket connects
 * to an address we vetted ourselves, which closes the DNS-rebinding window
 * between validation and connection.
 */
const safeLookup: NonNullable<https.RequestOptions['lookup']> = (hostname, options, callback) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const done = callback as any

  dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      const allowed = addresses.filter((entry) => !isBlockedAddress(entry.address))
      if (!allowed.length) {
        const error: NodeJS.ErrnoException = new Error(
          `${hostname} resolves only to private or reserved addresses`,
        )
        error.code = 'EBLOCKEDADDRESS'
        done(error)
        return
      }
      if (options && (options as { all?: boolean }).all) {
        done(null, allowed)
      } else {
        done(null, allowed[0].address, allowed[0].family)
      }
    })
    .catch((error: NodeJS.ErrnoException) => done(error))
}

/** `status` values a health endpoint may report while still being healthy. */
const HEALTHY_REPORTED = new Set(['ok', 'up', 'healthy', 'pass', 'passing', 'success', 'green', 'true'])

/** Only this much of a health response is read before the socket is torn down. */
const MAX_HEALTH_BODY_BYTES = numberFromEnv('MAX_HEALTH_BODY_BYTES', 64 * 1024)

/**
 * Pull the reported status out of a health-check body.
 * Returns null when the body is not JSON or carries no recognisable status
 * field — such an endpoint is then judged on its HTTP code alone.
 */
function readReportedStatus(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as Record<string, unknown>
  const raw = record.status ?? record.state ?? record.health
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'boolean') return String(raw)
  return null
}

/**
 * Probe one URL. Resolves with the observed status — never rejects.
 * Response time is measured up to the first response byte.
 *
 * With `readBody`, up to MAX_HEALTH_BODY_BYTES of the response is buffered so a
 * health endpoint's JSON can be inspected; otherwise the body is discarded
 * because only reachability matters.
 */
function probe(url: string, options: { readBody?: boolean } = {}): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const startedAt = process.hrtime.bigint()
    let settled = false

    const finish = (result: ProbeResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6

    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: options.readBody ? 'application/json, */*' : '*/*',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        // Redirects are *not* followed: a 3xx is a healthy answer by itself and
        // following one would re-open the SSRF surface.
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const responseTime = Math.round(elapsedMs())
        const statusCode = response.statusCode ?? 0
        const codeHealthy = statusCode >= 200 && statusCode <= 399

        if (!options.readBody) {
          response.resume() // drain and free the socket
          response.destroy()
          request.destroy()
          finish({
            status: codeHealthy ? 'UP' : 'DOWN',
            statusCode,
            responseTime,
            error: codeHealthy ? null : `HTTP ${statusCode}`,
          })
          return
        }

        const chunks: Buffer[] = []
        let received = 0

        const settleWithBody = () => {
          const reported = readReportedStatus(Buffer.concat(chunks).toString('utf8'))

          if (!codeHealthy) {
            finish({
              status: 'DOWN',
              statusCode,
              responseTime,
              error: `HTTP ${statusCode}`,
              reported,
            })
            return
          }
          if (reported !== null && !HEALTHY_REPORTED.has(reported.toLowerCase())) {
            finish({
              status: 'DOWN',
              statusCode,
              responseTime,
              error: `Reported status "${reported.slice(0, 60)}"`,
              reported,
            })
            return
          }
          finish({ status: 'UP', statusCode, responseTime, error: null, reported })
        }

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received <= MAX_HEALTH_BODY_BYTES) {
            chunks.push(chunk)
            return
          }
          // Oversized body: keep what we have and stop reading.
          response.destroy()
          request.destroy()
          settleWithBody()
        })
        response.on('end', settleWithBody)
        response.on('error', () => settleWithBody())
      },
    )

    request.on('timeout', () => {
      request.destroy()
      finish({
        status: 'DOWN',
        statusCode: null,
        responseTime: null,
        error: 'Connection timeout',
      })
    })

    request.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        status: 'DOWN',
        statusCode: null,
        responseTime: null,
        error:
          error.code === 'EBLOCKEDADDRESS'
            ? 'Blocked: resolves to a private address'
            : describeError(error),
      })
    })

    request.end()
  })
}

/** Validate a URL, then probe it. Invalid URLs are reported as DOWN, never thrown. */
async function checkUrl(url: string, options: { readBody?: boolean } = {}): Promise<ProbeResult> {
  const validation = validateMonitorUrl(url)
  if (!validation.ok) {
    return {
      status: 'DOWN',
      statusCode: null,
      responseTime: null,
      error: `Invalid URL: ${validation.error}`,
    }
  }
  if (isBlockedHostname(new URL(validation.url!).hostname)) {
    return {
      status: 'DOWN',
      statusCode: null,
      responseTime: null,
      error: 'Blocked: internal hostname',
    }
  }
  return probe(validation.url!, options)
}

/**
 * Check one monitor: its site URL, plus its health endpoint when configured.
 * A monitor is UP only when both are — a health endpoint reporting trouble
 * behind an HTTP 200 is exactly the case this is here to catch.
 */
async function checkMonitor(monitor: Monitor, timestamp: string): Promise<CheckResult> {
  const site = await checkUrl(monitor.url)

  let health: HealthResult | null = null
  if (monitor.healthUrl) {
    const result = await checkUrl(monitor.healthUrl, { readBody: true })
    health = {
      url: monitor.healthUrl,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error,
      reported: result.reported ?? null,
    }
  }

  const healthy = site.status === 'UP' && (!health || health.status === 'UP')
  const error =
    site.status === 'DOWN'
      ? site.error
      : health && health.status === 'DOWN'
        ? `Health check: ${health.error ?? 'failed'}`
        : null

  return {
    monitorId: monitor.id,
    status: healthy ? 'UP' : 'DOWN',
    statusCode: site.statusCode,
    responseTime: site.responseTime,
    error,
    timestamp,
    health,
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    log('  Telegram is not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — skipping alert')
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      // Never print the response verbatim: it can echo the bot token back.
      log(`  Telegram API returned ${response.status} — alert not delivered`)
    }
  } catch (error) {
    log(`  Telegram request failed: ${(error as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

function downMessage(monitor: Monitor, result: CheckResult): string {
  const lines = ['🔴 SITE DOWN', '', monitor.name, '', 'URL:', monitor.url, '']

  // The site answered but its health endpoint did not: report that instead,
  // otherwise the alert would read "HTTP 200" on a monitor that is down.
  const health = result.health
  if (result.statusCode !== null && health && health.status === 'DOWN') {
    lines.push('Health endpoint:', health.url, '')
    if (health.reported !== null) {
      lines.push('Reported:', health.reported, '')
    } else {
      lines.push('Error:', health.error ?? 'failed', '')
    }
    lines.push('Time:', formatFullTimestamp(result.timestamp))
    return lines.join('\n')
  }

  if (result.statusCode !== null) {
    lines.push('Status:', `HTTP ${result.statusCode}`, '')
    if (result.responseTime !== null) {
      lines.push('Response:', formatResponseTime(result.responseTime), '')
    }
  } else {
    lines.push('Error:', result.error ?? 'Request failed', '')
  }

  lines.push('Time:', formatFullTimestamp(result.timestamp))
  return lines.join('\n')
}

function recoveryMessage(monitor: Monitor, result: CheckResult, downtimeMs: number): string {
  const lines = [
    '🟢 SITE RECOVERED',
    '',
    monitor.name,
    '',
    'Downtime:',
    formatDuration(downtimeMs),
    '',
  ]

  if (result.statusCode !== null) {
    lines.push('Status:', `HTTP ${result.statusCode}`, '')
  }
  if (result.responseTime !== null) {
    lines.push('Response:', formatResponseTime(result.responseTime), '')
  }

  lines.push('Time:', formatFullTimestamp(result.timestamp))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function withinHours(entry: HistoryEntry, hours: number, now: number): boolean {
  const time = new Date(entry.timestamp).getTime()
  return Number.isFinite(time) && now - time <= hours * 3600_000
}

function uptimeOver(entries: HistoryEntry[], hours: number, now: number): number | null {
  const window = entries.filter((entry) => withinHours(entry, hours, now))
  if (!window.length) return null
  const up = window.filter((entry) => entry.status === 'UP').length
  return (up / window.length) * 100
}

function averageResponse(entries: HistoryEntry[], hours: number, now: number): number | null {
  const window = entries.filter(
    (entry) => withinHours(entry, hours, now) && entry.responseTime !== null,
  )
  if (!window.length) return null
  const total = window.reduce((sum, entry) => sum + (entry.responseTime ?? 0), 0)
  return Math.round(total / window.length)
}

/** Drop entries older than the retention window and enforce the hard cap. */
function trimHistory(entries: HistoryEntry[], now: number): HistoryEntry[] {
  const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 3600_000
  const kept = entries.filter((entry) => {
    const time = new Date(entry.timestamp).getTime()
    return Number.isFinite(time) && time >= cutoff
  })
  kept.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return kept.length > HISTORY_MAX_ENTRIES ? kept.slice(kept.length - HISTORY_MAX_ENTRIES) : kept
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now()
  const timestamp = new Date(startedAt).toISOString()

  const { data: monitorsFile } = await readJson<MonitorsFile>(PATHS.monitors, { monitors: [] })
  const monitors = Array.isArray(monitorsFile.monitors) ? monitorsFile.monitors : []
  const enabled = monitors.filter((monitor) => monitor.enabled !== false)

  const statusRead = await readJson<StatusFile>(PATHS.status, {
    updatedAt: '',
    lastCommitAt: null,
    monitors: {},
  })
  const historyRead = await readJson<HistoryFile>(PATHS.history, { entries: [] })
  const incidentsRead = await readJson<IncidentsFile>(PATHS.incidents, { incidents: [] })
  const bufferRead = await readJson<HistoryFile>(PATHS.buffer, { entries: [] })

  const previousStatus = statusRead.data.monitors ?? {}
  const incidents: Incident[] = [...(incidentsRead.data.incidents ?? [])]
  const bufferedEntries = (bufferRead.data.entries ?? []).filter(
    (entry) => entry && typeof entry.timestamp === 'string',
  )

  log(`Site Monitor — ${monitors.length} monitor(s), ${enabled.length} enabled`)

  if (!enabled.length) {
    log('Nothing to check. Add a monitor through the dashboard or edit data/monitors.json.')
    await setOutput('changed', 'false')
    await setOutput('summary', 'no monitors configured')
    return
  }

  // --- probe every enabled site -------------------------------------------
  const results = await mapWithConcurrency(enabled, CONCURRENCY, (monitor) =>
    checkMonitor(monitor, timestamp),
  )

  const resultById = new Map(results.map((result) => [result.monitorId, result]))
  const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]))

  // --- detect transitions --------------------------------------------------
  interface Transition {
    monitor: Monitor
    result: CheckResult
    kind: 'down' | 'recovered'
    downtimeMs?: number
  }

  const transitions: Transition[] = []
  const nextStatus: Record<string, MonitorStatus> = {}
  let statusChanged = false

  // Entries produced since the last commit: buffered runs plus this one.
  const newEntries: HistoryEntry[] = [
    ...bufferedEntries,
    ...results.map<HistoryEntry>((result) => ({
      timestamp: result.timestamp,
      monitorId: result.monitorId,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error,
    })),
  ]

  for (const monitor of monitors) {
    const previous = previousStatus[monitor.id]
    const result = resultById.get(monitor.id)

    // Disabled monitors keep their last known state untouched.
    if (!result) {
      if (previous) nextStatus[monitor.id] = previous
      continue
    }

    const sinceLastCommit = newEntries.filter((entry) => entry.monitorId === monitor.id)
    const upCount = sinceLastCommit.filter((entry) => entry.status === 'UP').length

    const changed = !previous || previous.status !== result.status
    if (changed) statusChanged = true

    if (previous && changed) {
      if (result.status === 'DOWN') {
        const incident: Incident = {
          id: `${monitor.id}-${result.timestamp}`,
          monitorId: monitor.id,
          startedAt: result.timestamp,
          endedAt: null,
          durationMs: null,
          status: 'ongoing',
          statusCode: result.statusCode,
          error: result.error,
          failedChecks: 1,
        }
        incidents.push(incident)
        transitions.push({ monitor, result, kind: 'down' })
      } else {
        const ongoing = [...incidents]
          .reverse()
          .find((entry) => entry.monitorId === monitor.id && entry.status === 'ongoing')
        const startedAt = ongoing ? new Date(ongoing.startedAt).getTime() : new Date(previous.since).getTime()
        const downtimeMs = Math.max(0, new Date(result.timestamp).getTime() - startedAt)
        if (ongoing) {
          ongoing.endedAt = result.timestamp
          ongoing.durationMs = downtimeMs
          ongoing.status = 'resolved'
          ongoing.failedChecks += sinceLastCommit.filter((entry) => entry.status === 'DOWN').length
        }
        transitions.push({ monitor, result, kind: 'recovered', downtimeMs })
      }
    } else if (previous && result.status === 'DOWN') {
      // Still down — keep counting failures, but stay quiet.
      const ongoing = [...incidents]
        .reverse()
        .find((entry) => entry.monitorId === monitor.id && entry.status === 'ongoing')
      if (ongoing) {
        ongoing.failedChecks += sinceLastCommit.filter((entry) => entry.status === 'DOWN').length
      }
    } else if (!previous && result.status === 'DOWN') {
      // First ever check already fails: open an incident and alert once.
      incidents.push({
        id: `${monitor.id}-${result.timestamp}`,
        monitorId: monitor.id,
        startedAt: result.timestamp,
        endedAt: null,
        durationMs: null,
        status: 'ongoing',
        statusCode: result.statusCode,
        error: result.error,
        failedChecks: 1,
      })
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
      health: result.health,
    }

    const symbol = result.status === 'UP' ? 'UP  ' : 'DOWN'
    const detail =
      result.status === 'UP'
        ? `${result.statusCode} · ${formatResponseTime(result.responseTime)}` +
          (result.health ? ` · health ${result.health.reported ?? result.health.status}` : '')
        : (result.error ?? 'failed')
    log(`  ${symbol} ${monitor.name} (${hostnameOf(monitor.url)}) — ${detail}`)
  }

  // Monitors deleted from monitors.json should not linger in status.json.
  const prunedStatus = Object.keys(previousStatus).some((id) => !monitorById.has(id))

  // --- history -------------------------------------------------------------
  // Retention is applied on every run but never forces a commit on its own:
  // once history spans 30 days something ages out constantly, and that would
  // turn every single run into a commit.
  const history = trimHistory([...(historyRead.data.entries ?? []), ...newEntries], startedAt)

  // Incidents belonging to deleted monitors go away with them.
  const liveIncidents = incidents.filter((incident) => monitorById.has(incident.monitorId))
  const incidentsChanged =
    JSON.stringify(liveIncidents) !== JSON.stringify(incidentsRead.data.incidents ?? [])

  // Fill in the rolling aggregates now that history is final.
  for (const status of Object.values(nextStatus)) {
    const forMonitor = history.filter((entry) => entry.monitorId === status.id)
    status.uptime24h = uptimeOver(forMonitor, 24, startedAt)
    status.uptime7d = uptimeOver(forMonitor, 24 * 7, startedAt)
    status.uptime30d = uptimeOver(forMonitor, 24 * 30, startedAt)
    status.avgResponse24h = averageResponse(forMonitor, 24, startedAt)
    status.incidents = liveIncidents.filter((incident) => incident.monitorId === status.id).length
  }

  // --- decide whether this run is worth a commit ---------------------------
  const lastCommitAt = statusRead.data.lastCommitAt
  const minutesSinceCommit = lastCommitAt
    ? (startedAt - new Date(lastCommitAt).getTime()) / 60_000
    : Number.POSITIVE_INFINITY

  const intervalElapsed = minutesSinceCommit >= COMMIT_INTERVAL_MINUTES
  const bufferFull = newEntries.length >= BUFFER_MAX_ENTRIES
  const firstRun = !statusRead.existed

  const shouldCommit =
    statusChanged ||
    incidentsChanged ||
    prunedStatus ||
    firstRun ||
    intervalElapsed ||
    bufferFull

  // --- notifications (always immediate, commit or not) ---------------------
  for (const transition of transitions) {
    const message =
      transition.kind === 'down'
        ? downMessage(transition.monitor, transition.result)
        : recoveryMessage(transition.monitor, transition.result, transition.downtimeMs ?? 0)
    log(`  Telegram: ${transition.kind === 'down' ? 'DOWN' : 'RECOVERED'} — ${transition.monitor.name}`)
    await sendTelegram(message)
  }

  // --- persist -------------------------------------------------------------
  if (shouldCommit) {
    const statusFile: StatusFile = {
      updatedAt: timestamp,
      lastCommitAt: timestamp,
      monitors: nextStatus,
    }
    await writeJson(PATHS.status, statusFile)
    await writeJson(PATHS.history, { entries: history } satisfies HistoryFile)
    await writeJson(PATHS.incidents, { incidents: liveIncidents } satisfies IncidentsFile)
    // The buffer has been folded into history.json.
    await writeJson(PATHS.buffer, { entries: [] } satisfies HistoryFile)

    const reason = statusChanged
      ? 'status change'
      : incidentsChanged
        ? 'incident update'
        : firstRun
          ? 'first run'
          : prunedStatus
            ? 'monitor removed'
            : 'scheduled flush'

    log(`Committing results (${reason}).`)
    await setOutput('changed', 'true')
    await setOutput('reason', reason)
  } else {
    // Nothing worth a commit: keep the samples in the run-to-run cache instead
    // so the git log does not become a log of every single check.
    await writeJson(PATHS.buffer, { entries: newEntries } satisfies HistoryFile)
    log(
      `No state change — buffering ${newEntries.length} sample(s); ` +
        `next flush in ${Math.max(0, Math.ceil(COMMIT_INTERVAL_MINUTES - minutesSinceCommit))} min.`,
    )
    await setOutput('changed', 'false')
    await setOutput('reason', 'no change')
  }

  const down = results.filter((result) => result.status === 'DOWN').length
  await setOutput(
    'summary',
    `${results.length} checked, ${results.length - down} up, ${down} down`,
  )
  log(`Done in ${Date.now() - startedAt} ms — ${results.length - down} up, ${down} down.`)
}

main().catch((error) => {
  process.stderr.write(`Monitoring run failed: ${(error as Error).stack ?? error}\n`)
  process.exit(1)
})
