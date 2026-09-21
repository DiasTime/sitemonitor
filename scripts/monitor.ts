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
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { confirmFailure } from '../lib/confirm'
import { isBlockedAddress, isBlockedHostname, validateMonitorUrl } from '../lib/security'
import {
  helpMessage,
  identify,
  parseCommand,
  passphraseRequiredMessage,
  statusMessage,
  subscribe,
  subscribedMessage,
  unknownCommandMessage,
  unsubscribe,
  unsubscribedMessage,
  type TelegramUpdate,
} from '../lib/telegram'
import { applyResults } from '../lib/transitions'
import type {
  CheckResult,
  HistoryEntry,
  HistoryFile,
  Incident,
  IncidentsFile,
  Monitor,
  MonitorsFile,
  ProbeResult,
  StatusFile,
  SubscribersFile,
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
  subscribers: path.join(ROOT, 'data/subscribers.json'),
  buffer: path.join(ROOT, '.monitor-cache/pending-history.json'),
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Like `numberFromEnv`, but 0 is a meaningful setting rather than "unset". */
function countFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = numberFromEnv('CHECK_TIMEOUT_MS', 10_000)
/**
 * How many extra probes a failure has to survive before it is believed.
 *
 * A single dropped connection used to be enough to open an incident and send
 * an alert, and with one check an hour that alert then stood for an hour. Set
 * to 0 to go back to believing the first answer.
 */
const CONFIRM_RETRIES = countFromEnv('CONFIRM_RETRIES', 2)
/** Pause between those probes — long enough to outlast a blip, short enough to fit the run. */
const CONFIRM_DELAY_MS = numberFromEnv('CONFIRM_DELAY_SECONDS', 10) * 1000
/**
 * How often an outage that is still going says so again.
 *
 * Alerts fire on transitions, so a long outage used to produce one message and
 * then silence — an incident here ran 33 hours on a single notification. Set
 * to 0 for the old behaviour: announce once, never mention it again.
 */
const REMINDER_INTERVAL_MS = countFromEnv('REMINDER_INTERVAL_MINUTES', 360) * 60_000
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

/**
 * How long a gap in checking has to be before the run reports it.
 *
 * A stalled schedule is the one failure this tool cannot see from the outside:
 * every monitor keeps its last known status, the dashboard keeps showing it,
 * and an hour nobody checked looks exactly like an hour when everything was
 * fine. GitHub drops scheduled ticks often enough that this is not theoretical
 * — it ran at a third of its schedule here for three weeks, unnoticed. So a
 * gap is announced like an outage, because that is what it is: a window with
 * no monitoring at all.
 */
const STALE_AFTER_MINUTES = numberFromEnv('STALE_AFTER_MINUTES', 90)

/**
 * How long one workflow run keeps checking, in minutes.
 *
 * GitHub's scheduler does not honour a three-minute cron — in practice it fires every
 * 20-60 minutes and silently drops the ticks in between. So instead of asking
 * for a run every three minutes, one run stays alive and does the checking
 * itself, on a real three-minute interval. Set to 0 for a single check and exit
 * (the default for `npm run monitor` locally).
 */
const LOOP_MINUTES = Number(process.env.LOOP_MINUTES ?? 0)
/** Interval between checks inside a run. */
const LOOP_INTERVAL_SECONDS = numberFromEnv('LOOP_INTERVAL_SECONDS', 180)

/**
 * Send one test alert and exit, without checking anything.
 *
 * Alerts only fire on transitions, so there is otherwise no way to confirm the
 * bot is wired up without waiting for a real outage.
 */
const SEND_TEST_ALERT = /^(1|true|yes|on)$/i.test(process.env.SEND_TEST_ALERT ?? '')

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

/** Only this much of a login-flow response is read before the socket is torn down. */
const MAX_LOGIN_BODY_BYTES = numberFromEnv('MAX_LOGIN_BODY_BYTES', 256 * 1024)

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

// ---------------------------------------------------------------------------
// Portal login checks
// ---------------------------------------------------------------------------

interface RawResponse {
  statusCode: number | null
  headers: http.IncomingHttpHeaders
  body: string
  responseTime: number | null
  error: string | null
}

/**
 * Low-level HTTP request used by the login-check flow: unlike `probe`, it can
 * POST a body, send arbitrary headers, and returns the response headers and
 * body for inspection. Redirects are never followed, for the same reason as
 * `probe` — SSRF protection would otherwise have to cover every hop. Resolves
 * with the observed outcome — never rejects.
 */
function rawRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve) => {
    const client = new URL(url).protocol === 'https:' ? https : http
    const startedAt = process.hrtime.bigint()
    let settled = false

    const finish = (result: RawResponse) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6
    const payload = options.body ?? ''

    const request = client.request(
      url,
      {
        method: options.method ?? 'GET',
        lookup: safeLookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,*/*',
          'Accept-Encoding': 'identity',
          Connection: 'close',
          ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
          ...options.headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const responseTime = Math.round(elapsedMs())
        const statusCode = response.statusCode ?? 0
        const chunks: Buffer[] = []
        let received = 0

        const settleWithBody = () => {
          finish({
            statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            responseTime,
            error: null,
          })
        }

        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received <= MAX_LOGIN_BODY_BYTES) {
            chunks.push(chunk)
            return
          }
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
        statusCode: null,
        headers: {},
        body: '',
        responseTime: null,
        error: 'Connection timeout',
      })
    })

    request.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        statusCode: null,
        headers: {},
        body: '',
        responseTime: null,
        error:
          error.code === 'EBLOCKEDADDRESS'
            ? 'Blocked: resolves to a private address'
            : describeError(error),
      })
    })

    if (payload) request.write(payload)
    request.end()
  })
}

/** Validate and SSRF-check a URL, then issue a raw request against it. */
async function checkedRawRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  const validation = validateMonitorUrl(url)
  if (!validation.ok) {
    return {
      statusCode: null,
      headers: {},
      body: '',
      responseTime: null,
      error: `Invalid URL: ${validation.error}`,
    }
  }
  if (isBlockedHostname(new URL(validation.url!).hostname)) {
    return { statusCode: null, headers: {}, body: '', responseTime: null, error: 'Blocked: internal hostname' }
  }
  return rawRequest(validation.url!, options)
}

/** Join a response's Set-Cookie headers into a value usable for a request's Cookie header. */
function cookieHeaderFrom(headers: http.IncomingHttpHeaders): string | null {
  const raw = headers['set-cookie']
  if (!raw || !raw.length) return null
  const pairs = raw.map((entry) => entry.split(';', 1)[0].trim()).filter(Boolean)
  return pairs.length ? pairs.join('; ') : null
}

/**
 * Hidden `<input>` fields found in an HTML form (CSRF tokens and the like),
 * carried through to the login POST unchanged so the submission looks like a
 * real form post rather than a bare username/password pair.
 */
function hiddenFieldsOf(html: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const inputTag = /<input\b[^>]*>/gi
  const nameAttr = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/i
  const valueAttr = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/i
  let match: RegExpExecArray | null
  while ((match = inputTag.exec(html))) {
    const tag = match[0]
    if (!/\btype\s*=\s*["']?hidden["']?/i.test(tag)) continue
    const name = nameAttr.exec(tag)
    if (!name) continue
    const fieldName = name[1] ?? name[2]
    if (!fieldName) continue
    const value = valueAttr.exec(tag)
    fields[fieldName] = value?.[1] ?? value?.[2] ?? ''
  }
  return fields
}

/** True when the page contains a password input, i.e. it is showing a sign-in form. */
function hasPasswordField(html: string): boolean {
  return /<input\b[^>]*\btype\s*=\s*["']?password["']?[^>]*>/i.test(html)
}

interface PortalCredential {
  username: string
  password: string
  /** Sent as the `X-Site-Key` header, for a multi-tenant backend that needs one to pick the right site. */
  siteKey?: string
}

let credentialsCache: Record<string, Partial<PortalCredential>> | null = null

/** Pick out only the recognised, string-typed fields of a credential entry. */
function readCredentialFields(value: unknown): Partial<PortalCredential> {
  if (!value || typeof value !== 'object') return {}
  const candidate = value as Partial<Record<keyof PortalCredential, unknown>>
  return {
    ...(typeof candidate.username === 'string' ? { username: candidate.username } : {}),
    ...(typeof candidate.password === 'string' ? { password: candidate.password } : {}),
    ...(typeof candidate.siteKey === 'string' ? { siteKey: candidate.siteKey } : {}),
  }
}

/**
 * Credentials for `login` monitors — one JSON secret. A `"default"` entry
 * applies to every `login` monitor; a per-id entry (keyed by monitor id)
 * overrides/extends it, so when the same account works everywhere except one
 * field (e.g. a per-portal `siteKey`), only that field needs repeating:
 *
 *   {"default": {"username": "...", "password": "..."},
 *    "darynast-kz": {"siteKey": "..."}}
 *
 * Set as the `PORTAL_CREDENTIALS` GitHub Actions secret — never written to
 * data/monitors.json, which is public and committed to the repo.
 */
function credentialsFor(monitorId: string): PortalCredential | null {
  if (credentialsCache === null) {
    credentialsCache = {}
    const raw = process.env.PORTAL_CREDENTIALS?.trim()
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        for (const [id, value] of Object.entries(parsed)) {
          credentialsCache[id] = readCredentialFields(value)
        }
      } catch (error) {
        log(`  PORTAL_CREDENTIALS is not valid JSON: ${(error as Error).message}`)
      }
    }
  }

  const merged = { ...credentialsCache.default, ...credentialsCache[monitorId] }
  if (typeof merged.username === 'string' && typeof merged.password === 'string') {
    return { username: merged.username, password: merged.password, ...(merged.siteKey ? { siteKey: merged.siteKey } : {}) }
  }
  return null
}

/**
 * Check a `login` monitor: fetch the sign-in page, submit the credentials
 * configured for this monitor's id, and judge the result. Two body styles are
 * supported (`monitor.loginBodyType`): `form` posts application/x-www-form-urlencoded
 * with any hidden fields (CSRF tokens) carried over from the page; `json`
 * posts a JSON object, for an API-driven single-page app.
 *
 * Success is decided, in order:
 *  1. `monitor.failureText` present in the response -> DOWN.
 *  2. `monitor.successText` set -> UP only if present in the response.
 *  3. A redirect (3xx) -> UP, the common outcome of a successful form post.
 *  4. `json` mode -> UP unless the body carries its own `error`/`message` field.
 *  5. `form` mode -> UP unless the response still shows a password field where
 *     the original sign-in page had one, i.e. the same form was handed back.
 *
 * This needs no portal-specific knowledge for a plain HTML login form or a
 * REST API that reports errors as JSON, but `successText`/`failureText`
 * should be set for anything more unusual (a login that always 200s with no
 * error field, etc).
 */
async function checkLoginMonitor(monitor: Monitor, timestamp: string): Promise<CheckResult> {
  const credential = credentialsFor(monitor.id)
  if (!credential) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode: null,
      responseTime: null,
      error: `No credentials configured for "${monitor.id}" in PORTAL_CREDENTIALS`,
      timestamp,
      reported: null,
    }
  }

  const pageUrl = monitor.url
  const page = await checkedRawRequest(pageUrl, { method: 'GET' })
  if (page.error || page.statusCode === null) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode: page.statusCode,
      responseTime: page.responseTime,
      error: page.error ?? 'Could not load the sign-in page',
      timestamp,
      reported: null,
    }
  }

  const cookie = cookieHeaderFrom(page.headers)
  const usernameField = monitor.usernameField || 'username'
  const passwordField = monitor.passwordField || 'password'
  const isJson = monitor.loginBodyType === 'json'
  const pageHadPasswordField = !isJson && hasPasswordField(page.body)

  let body: string
  let contentType: string
  if (isJson) {
    body = JSON.stringify({ [usernameField]: credential.username, [passwordField]: credential.password })
    contentType = 'application/json'
  } else {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(hiddenFieldsOf(page.body))) form.set(key, value)
    form.set(usernameField, credential.username)
    form.set(passwordField, credential.password)
    body = form.toString()
    contentType = 'application/x-www-form-urlencoded'
  }

  const submission = await checkedRawRequest(monitor.loginUrl || monitor.url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Referer: pageUrl,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(credential.siteKey ? { 'X-Site-Key': credential.siteKey } : {}),
    },
    body,
  })

  const responseTime = submission.responseTime ?? page.responseTime

  if (submission.error || submission.statusCode === null) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode: submission.statusCode,
      responseTime,
      error: submission.error ?? 'Sign-in request failed',
      timestamp,
      reported: null,
    }
  }

  const statusCode = submission.statusCode

  /** A REST API typically explains a failure in the body — pull it out for a more useful alert than "HTTP 401". */
  function apiErrorMessage(): string | null {
    try {
      const parsed = JSON.parse(submission.body) as Record<string, unknown>
      const message = parsed?.error ?? parsed?.message
      return typeof message === 'string' && message ? message.slice(0, 200) : null
    } catch {
      return null
    }
  }

  if (statusCode < 200 || statusCode > 399) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode,
      responseTime,
      error: apiErrorMessage() ?? `HTTP ${statusCode}`,
      timestamp,
      reported: null,
    }
  }

  const bodyLower = submission.body.toLowerCase()

  if (monitor.failureText && bodyLower.includes(monitor.failureText.toLowerCase())) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode,
      responseTime,
      error: `Sign-in failed: matched "${monitor.failureText}"`,
      timestamp,
      reported: null,
    }
  }

  if (monitor.successText) {
    const matched = bodyLower.includes(monitor.successText.toLowerCase())
    return {
      monitorId: monitor.id,
      status: matched ? 'UP' : 'DOWN',
      statusCode,
      responseTime,
      error: matched ? null : `Sign-in did not report "${monitor.successText}"`,
      timestamp,
      reported: null,
    }
  }

  if (statusCode >= 300 && statusCode < 400) {
    return { monitorId: monitor.id, status: 'UP', statusCode, responseTime, error: null, timestamp, reported: null }
  }

  if (isJson) {
    // A JSON API never hands back a password field, so the redirect/form
    // heuristic below does not apply — fall back to the body's own error
    // signal (both `/api/auth/login` failures seen from this app family
    // answer 200 or 4xx with an `{"error": "..."}` body; this catches the
    // 200-with-error-body case the status-code check above would miss).
    const message = apiErrorMessage()
    if (message) {
      return { monitorId: monitor.id, status: 'DOWN', statusCode, responseTime, error: message, timestamp, reported: null }
    }
    return { monitorId: monitor.id, status: 'UP', statusCode, responseTime, error: null, timestamp, reported: null }
  }

  if (pageHadPasswordField && hasPasswordField(submission.body)) {
    return {
      monitorId: monitor.id,
      status: 'DOWN',
      statusCode,
      responseTime,
      error: 'Sign-in form was shown again after submitting credentials',
      timestamp,
      reported: null,
    }
  }

  return { monitorId: monitor.id, status: 'UP', statusCode, responseTime, error: null, timestamp, reported: null }
}

/**
 * Check one monitor. A `health` monitor has its JSON body inspected as well as
 * its HTTP code, so an endpoint answering 200 while reporting trouble is DOWN.
 * A `login` monitor actually signs in — see `checkLoginMonitor`.
 */
async function checkMonitor(monitor: Monitor, timestamp: string): Promise<CheckResult> {
  if (monitor.type === 'login') return checkLoginMonitor(monitor, timestamp)

  const isHealth = monitor.type === 'health'
  const result = await checkUrl(monitor.url, { readBody: isHealth })

  return {
    monitorId: monitor.id,
    status: result.status,
    statusCode: result.statusCode,
    responseTime: result.responseTime,
    error: result.error,
    timestamp,
    reported: result.reported ?? null,
  }
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

const TELEGRAM_API = 'https://api.telegram.org'

/**
 * Optional passphrase for subscribing. When set, only `/start <passphrase>`
 * subscribes — without it, anyone who finds the bot receives your alerts,
 * which name your hosts and their outage windows.
 */
const SUBSCRIBE_PASSWORD = process.env.TELEGRAM_SUBSCRIBE_PASSWORD?.trim() || ''

function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null
}

interface TelegramResult<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

/**
 * Call the Bot API. Never surfaces the raw response, which can echo the token
 * back in the URL it quotes.
 */
async function telegram<T>(
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramResult<T>> {
  const token = telegramToken()
  if (!token) return { ok: false, description: 'no token' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => ({}))) as TelegramResult<T>
    if (!response.ok) {
      return {
        ok: false,
        error_code: body.error_code ?? response.status,
        description: body.description ?? `HTTP ${response.status}`,
      }
    }
    return body
  } catch (error) {
    return { ok: false, description: (error as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pick up `/start` and `/stop` sent to the bot since the last run.
 *
 * There is no server to receive a webhook, so the monitoring run polls
 * getUpdates instead. Telegram keeps updates for 24 hours, which comfortably
 * covers the gap between runs, and the offset is persisted so the same update
 * is never processed twice.
 */
async function syncSubscribers(
  current: SubscribersFile,
): Promise<{ file: SubscribersFile; changed: boolean }> {
  if (!telegramToken()) return { file: current, changed: false }

  const response = await telegram<TelegramUpdate[]>('getUpdates', {
    offset: current.offset || undefined,
    timeout: 0,
    allowed_updates: ['message'],
  })

  if (!response.ok) {
    // 409 means a webhook is registered, so Telegram delivers messages to the
    // dashboard instead and refuses to hand them over here as well. That is a
    // working setup, not a failure: the dashboard answers in a second where
    // this poll would answer within the hour.
    if (response.error_code === 409) {
      log('  Telegram: answered by the dashboard webhook — not polling here')
    } else {
      log(`  Telegram getUpdates failed: ${response.description ?? 'unknown error'}`)
    }
    return { file: current, changed: false }
  }

  const updates = response.result ?? []
  if (!updates.length) return { file: current, changed: false }

  let file: SubscribersFile = { offset: current.offset, subscribers: [...current.subscribers] }
  let changed = false

  for (const update of updates) {
    file = { ...file, offset: Math.max(file.offset, update.update_id + 1) }
    const message = update.message
    const command = parseCommand(message?.text)
    if (!message || !command) continue

    const chat = identify(message)

    if (command.name === 'start') {
      if (SUBSCRIBE_PASSWORD && command.argument !== SUBSCRIBE_PASSWORD) {
        await telegram('sendMessage', { chat_id: chat.chatId, text: passphraseRequiredMessage() })
        continue
      }

      const added = subscribe(file, chat, new Date().toISOString())
      if (added.changed) {
        file = added.file
        changed = true
        log(`  Telegram: subscribed ${chat.label} (${chat.chatId})`)
      }
      await telegram('sendMessage', {
        chat_id: chat.chatId,
        text: subscribedMessage(),
        disable_web_page_preview: true,
      })
      continue
    }

    if (command.name === 'stop') {
      const removed = unsubscribe(file, chat.chatId)
      if (removed.changed) {
        file = removed.file
        changed = true
        log(`  Telegram: unsubscribed ${removed.removed?.label ?? chat.label} (${chat.chatId})`)
      }
      await telegram('sendMessage', { chat_id: chat.chatId, text: unsubscribedMessage() })
      continue
    }

    if (command.name === 'status') {
      // Read from disk rather than from this run: the board is what has been
      // recorded so far, and this runs before the run's own probes.
      const { data: monitorsFile } = await readJson<MonitorsFile>(PATHS.monitors, { monitors: [] })
      const { data: status } = await readJson<StatusFile>(PATHS.status, {
        updatedAt: '',
        lastCommitAt: null,
        monitors: {},
      })
      await telegram('sendMessage', {
        chat_id: chat.chatId,
        text: statusMessage(monitorsFile.monitors ?? [], status, Date.now(), {
          staleAfterMs: STALE_AFTER_MINUTES * 60_000,
        }),
        disable_web_page_preview: true,
      })
      continue
    }

    await telegram('sendMessage', {
      chat_id: chat.chatId,
      text: command.name === 'help' ? helpMessage() : unknownCommandMessage(),
      disable_web_page_preview: true,
    })
  }

  if (file.offset !== current.offset) changed = true
  return { file, changed }
}

/** Chat ids that should receive alerts: the configured owner plus every subscriber. */
function recipientsOf(file: SubscribersFile): number[] {
  const ids: number[] = []
  const owner = process.env.TELEGRAM_CHAT_ID?.trim()
  if (owner) {
    const parsed = Number(owner)
    if (Number.isFinite(parsed)) ids.push(parsed)
  }
  for (const subscriber of file.subscribers) {
    if (!ids.includes(subscriber.chatId)) ids.push(subscriber.chatId)
  }
  return ids
}

/**
 * Send an alert to every recipient.
 *
 * Chats that have blocked or deleted the bot are dropped from the list: they
 * can never be delivered to again, and left in place they would fail on every
 * future alert. Returns the chat ids to remove.
 */
async function broadcast(file: SubscribersFile, text: string): Promise<number[]> {
  if (!telegramToken()) {
    log('  Telegram is not configured (TELEGRAM_BOT_TOKEN) — skipping alert')
    return []
  }

  const recipients = recipientsOf(file)
  if (!recipients.length) {
    log('  Telegram has no recipients yet — send /start to the bot to subscribe')
    return []
  }

  const dead: number[] = []
  let delivered = 0

  for (const chatId of recipients) {
    const response = await telegram('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    })

    if (response.ok) {
      delivered += 1
      continue
    }

    const code = response.error_code
    // 403: blocked, kicked or deactivated. 400: chat no longer exists.
    if (code === 403 || code === 400) {
      dead.push(chatId)
      log(`  Telegram: dropping ${chatId} (${response.description ?? code})`)
    } else {
      log(`  Telegram: delivery to ${chatId} failed (${response.description ?? code})`)
    }
  }

  log(`  Telegram: delivered to ${delivered}/${recipients.length} chat(s)`)
  return dead
}

function downMessage(monitor: Monitor, result: CheckResult): string {
  const heading =
    monitor.type === 'health'
      ? '🔴 HEALTH CHECK FAILED'
      : monitor.type === 'login'
        ? '🔴 PORTAL LOGIN FAILED'
        : '🔴 SITE DOWN'
  const lines = [heading, '', monitor.name, '', 'URL:', monitor.url, '']

  // A health endpoint that answered 200 but reported trouble: say what it
  // reported, since "HTTP 200" would read as if nothing were wrong.
  if (result.statusCode !== null && result.reported !== null) {
    lines.push('Reported:', result.reported, '')
    lines.push('Status:', `HTTP ${result.statusCode}`, '')
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
    monitor.type === 'health'
      ? '🟢 HEALTH CHECK RECOVERED'
      : monitor.type === 'login'
        ? '🟢 PORTAL LOGIN RECOVERED'
        : '🟢 SITE RECOVERED',
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

function stillDownMessage(monitor: Monitor, incident: Incident, downtimeMs: number): string {
  const lines = [
    monitor.type === 'health'
      ? '🔴 HEALTH CHECK STILL FAILING'
      : monitor.type === 'login'
        ? '🔴 PORTAL LOGIN STILL FAILING'
        : '🔴 SITE STILL DOWN',
    '',
    monitor.name,
    '',
    'Down for:',
    formatDuration(downtimeMs),
    '',
    'Since:',
    formatFullTimestamp(incident.startedAt),
    '',
    'Failed checks:',
    String(incident.failedChecks),
    '',
  ]

  if (incident.error) lines.push('Error:', incident.error, '')
  else if (incident.statusCode !== null) lines.push('Status:', `HTTP ${incident.statusCode}`, '')

  lines.push('URL:', monitor.url)
  return lines.join('\n')
}

function monitoringGapMessage(gapMs: number, lastCheckIso: string, nowIso: string): string {
  return [
    '⚠️ MONITORING GAP',
    '',
    'Nothing was checked for:',
    formatDuration(gapMs),
    '',
    'Last check before the gap:',
    formatFullTimestamp(lastCheckIso),
    '',
    'Checking resumed:',
    formatFullTimestamp(nowIso),
    '',
    'Any outage inside that window went undetected — the statuses below it are',
    'older than they look.',
  ].join('\n')
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
// Committing from inside a long run
// ---------------------------------------------------------------------------

/**
 * A looping run cannot wait for the workflow's commit step — an outage detected
 * in minute 2 must reach the dashboard long before minute 50. So the loop
 * commits and pushes for itself.
 */
async function git(args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: ROOT }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() })
    })
  })
}

let gitConfigured = false

/** Commit and push data/, rebasing over anything the dashboard wrote meanwhile. */
async function commitAndPush(message: string): Promise<boolean> {
  if (!gitConfigured) {
    await git(['config', 'user.name', 'github-actions[bot]'])
    await git([
      'config',
      'user.email',
      '41898282+github-actions[bot]@users.noreply.github.com',
    ])
    gitConfigured = true
  }

  await git(['add', 'data'])
  const staged = await git(['diff', '--staged', '--quiet'])
  if (staged.ok) return false // nothing actually changed on disk

  const committed = await git(['commit', '-m', message])
  if (!committed.ok) {
    log(`  git commit failed: ${committed.output}`)
    return false
  }

  const branch = process.env.GITHUB_REF_NAME || 'main'
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const pushed = await git(['push', 'origin', `HEAD:${branch}`])
    if (pushed.ok) return true
    log(`  push rejected (attempt ${attempt}), rebasing onto origin/${branch}...`)
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
    await git(['pull', '--rebase', '--autostash', 'origin', branch])
  }

  log('  could not push monitoring results after 5 attempts')
  return false
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** One pass over every monitor. Returns whether anything was committed. */
async function runOnce(): Promise<void> {
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
  const subscribersRead = await readJson<SubscribersFile>(PATHS.subscribers, {
    offset: 0,
    subscribers: [],
  })

  // Pick up anyone who sent /start or /stop since the last pass, before any
  // alert goes out, so a fresh subscriber gets this run's news too.
  const sync = await syncSubscribers(subscribersRead.data)
  let subscribers = sync.file
  let subscribersChanged = sync.changed

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
  // A failure is probed again before it is believed, so a single dropped
  // connection does not open an incident. Sites already known to be down are
  // probed once: the extra looks would change no decision there, and the run
  // has a budget.
  const results = await mapWithConcurrency(enabled, CONCURRENCY, (monitor) =>
    confirmFailure(() => checkMonitor(monitor, timestamp), {
      retries: CONFIRM_RETRIES,
      delayMs: CONFIRM_DELAY_MS,
      confirm: previousStatus[monitor.id]?.status !== 'DOWN',
      onRetry: (attempt, failure) =>
        log(
          `  ? ${monitor.name} — ${failure.error ?? 'failed'}; re-checking ` +
            `(${attempt}/${CONFIRM_RETRIES}) in ${Math.round(CONFIRM_DELAY_MS / 1000)}s`,
        ),
      onDisagree: (attempt, failure) =>
        log(
          `  UP ${monitor.name} — recovered on re-check ${attempt}, ` +
            `not alerting on "${failure.error ?? 'failure'}"`,
        ),
    }),
  )

  const resultById = new Map(results.map((result) => [result.monitorId, result]))
  const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]))

  // --- decide what the probes mean ----------------------------------------
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

  const { nextStatus, transitions, reminders, statusChanged } = applyResults({
    monitors,
    results,
    previousStatus,
    incidents,
    newEntries,
    timestamp,
    now: startedAt,
    reminderIntervalMs: REMINDER_INTERVAL_MS,
  })

  for (const monitor of monitors) {
    const result = resultById.get(monitor.id)
    if (!result) continue

    const symbol = result.status === 'UP' ? 'UP  ' : 'DOWN'
    const detail =
      result.status === 'UP'
        ? `${result.statusCode} · ${formatResponseTime(result.responseTime)}` +
          (result.reported ? ` · reported ${result.reported}` : '')
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
    // Reminders only move `lastNotifiedAt` on an object the comparison above
    // sees on both sides, so they have to ask for the commit themselves — or
    // the same reminder would be due again on the next run.
    reminders.length > 0 ||
    prunedStatus ||
    firstRun ||
    intervalElapsed ||
    bufferFull ||
    subscribersChanged

  // --- notifications (always immediate, commit or not) ---------------------
  const notify = async (message: string): Promise<void> => {
    const dead = await broadcast(subscribers, message)
    if (!dead.length) return
    subscribers = {
      ...subscribers,
      subscribers: subscribers.subscribers.filter((entry) => !dead.includes(entry.chatId)),
    }
    subscribersChanged = true
  }

  // A gap in checking is reported before anything else, because it changes how
  // to read everything else: the statuses this run is about to replace were
  // last confirmed before the gap, not during it.
  //
  // The newest of the three records of "when a check last happened" is used —
  // status.json (written on every commit), the tail of history.json, and the
  // between-commit buffer — so a run that only buffered still counts as
  // coverage, and a lost buffer cache cannot invent a gap on its own.
  const historyEntries = historyRead.data.entries ?? []
  const previousCheckAt = [
    statusRead.data.updatedAt,
    historyEntries[historyEntries.length - 1]?.timestamp,
    ...bufferedEntries.map((entry) => entry.timestamp),
  ].reduce((latest, value) => {
    const time = value ? new Date(value).getTime() : Number.NaN
    return Number.isFinite(time) && time > latest ? time : latest
  }, 0)

  const gapMs = previousCheckAt ? startedAt - previousCheckAt : 0
  if (gapMs > STALE_AFTER_MINUTES * 60_000) {
    log(`  Telegram: MONITORING GAP — ${formatDuration(gapMs)} with no checks`)
    await notify(
      monitoringGapMessage(gapMs, new Date(previousCheckAt).toISOString(), timestamp),
    )
  }

  for (const transition of transitions) {
    const message =
      transition.kind === 'down'
        ? downMessage(transition.monitor, transition.result)
        : recoveryMessage(transition.monitor, transition.result, transition.downtimeMs ?? 0)
    log(`  Telegram: ${transition.kind === 'down' ? 'DOWN' : 'RECOVERED'} — ${transition.monitor.name}`)
    await notify(message)
  }

  // Said last, after the news: an outage that was already known is the least
  // urgent thing in the message list, but it must not be the silent one.
  for (const reminder of reminders) {
    log(
      `  Telegram: STILL DOWN — ${reminder.monitor.name} ` +
        `(${formatDuration(reminder.downtimeMs)})`,
    )
    await notify(stillDownMessage(reminder.monitor, reminder.incident, reminder.downtimeMs))
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
    await writeJson(PATHS.subscribers, subscribers satisfies SubscribersFile)
    // The buffer has been folded into history.json.
    await writeJson(PATHS.buffer, { entries: [] } satisfies HistoryFile)

    const reason = statusChanged
      ? 'status change'
      : incidentsChanged
        ? 'incident update'
        : reminders.length
        ? 'outage reminder'
        : subscribersChanged
        ? 'subscriber update'
        : firstRun
          ? 'first run'
          : prunedStatus
            ? 'monitor removed'
            : 'scheduled flush'

    await setOutput('changed', 'true')
    await setOutput('reason', reason)

    if (LOOP_MINUTES > 0) {
      const down = Object.values(nextStatus).filter((entry) => entry.status === 'DOWN').length
      const pushed = await commitAndPush(
        `chore(monitor): ${reason} (${Object.keys(nextStatus).length} monitors, ${down} down)`,
      )
      log(pushed ? `Committed and pushed (${reason}).` : `Nothing to push (${reason}).`)
    } else {
      log(`Committing results (${reason}).`)
    }
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

/**
 * Deliver a test alert to every recipient and report who got it.
 * Picks up pending /start messages first, so someone who just subscribed is
 * included in the very test they are waiting for.
 */
async function sendTestAlert(): Promise<void> {
  const read = await readJson<SubscribersFile>(PATHS.subscribers, { offset: 0, subscribers: [] })
  const sync = await syncSubscribers(read.data)
  let subscribers = sync.file
  let changed = sync.changed

  const recipients = recipientsOf(subscribers)
  log(
    `Test alert: ${recipients.length} recipient(s) — ` +
      `${subscribers.subscribers.length} subscriber(s)` +
      `${process.env.TELEGRAM_CHAT_ID?.trim() ? ' plus TELEGRAM_CHAT_ID' : ''}`,
  )

  const message = [
    '🧪 TEST ALERT',
    '',
    'Site Monitor is wired up and can reach you.',
    '',
    'This was sent by hand from GitHub Actions.',
    'Nothing is down.',
    '',
    'Time:',
    formatFullTimestamp(new Date().toISOString()),
  ].join('\n')

  const dead = await broadcast(subscribers, message)
  if (dead.length) {
    subscribers = {
      ...subscribers,
      subscribers: subscribers.subscribers.filter((entry) => !dead.includes(entry.chatId)),
    }
    changed = true
  }

  if (changed) await writeJson(PATHS.subscribers, subscribers satisfies SubscribersFile)

  await setOutput('changed', changed ? 'true' : 'false')
  await setOutput('reason', 'test alert')
  await setOutput(
    'summary',
    `test alert sent to ${recipients.length - dead.length}/${recipients.length} chat(s)`,
  )
}

/**
 * Single check, or a run that keeps checking for LOOP_MINUTES on a real
 * LOOP_INTERVAL_SECONDS cadence. One failing pass never ends the loop — a
 * transient error must not take monitoring down until the next schedule.
 */
async function main() {
  if (SEND_TEST_ALERT) {
    await sendTestAlert()
    return
  }

  if (LOOP_MINUTES <= 0) {
    await runOnce()
    return
  }

  const endsAt = Date.now() + LOOP_MINUTES * 60_000
  const intervalMs = LOOP_INTERVAL_SECONDS * 1000
  let pass = 0

  log(
    `Loop mode: checking every ${LOOP_INTERVAL_SECONDS}s for ${LOOP_MINUTES} min ` +
      `(~${Math.max(1, Math.floor((LOOP_MINUTES * 60) / LOOP_INTERVAL_SECONDS))} passes).`,
  )

  for (;;) {
    const passStartedAt = Date.now()
    pass += 1
    log(`\n--- pass ${pass} ---`)

    try {
      await runOnce()
    } catch (error) {
      process.stderr.write(`Pass ${pass} failed: ${(error as Error).message}\n`)
    }

    const nextAt = passStartedAt + intervalMs
    if (nextAt >= endsAt) {
      log(`\nLoop window finished after ${pass} pass(es).`)
      return
    }
    const wait = Math.max(0, nextAt - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

main().catch((error) => {
  process.stderr.write(`Monitoring run failed: ${(error as Error).stack ?? error}\n`)
  process.exit(1)
})
