/** Shared data model. These types describe the JSON files stored in `data/`. */

export type Status = 'UP' | 'DOWN'

/** Transient UI-only status, never persisted. */
export type UiStatus = Status | 'CHECKING'

/**
 * What kind of endpoint a monitor points at.
 *
 * - `website` — judged by its HTTP status code alone.
 * - `health`  — a health-check endpoint: the JSON body is read as well, and its
 *               `status` field must report a healthy value.
 * - `login`   — a portal login form: the monitor actually signs in (see the
 *               `login*` fields below) and the platform only counts as up when
 *               the sign-in itself succeeds, not merely when the page loads.
 *
 * Absent means `website`, so monitors created before this existed keep working.
 */
export type MonitorType = 'website' | 'health' | 'login'

export interface Monitor {
  id: string
  name: string
  url: string
  enabled: boolean
  type?: MonitorType
  /** ISO timestamp, set when the monitor was added through the dashboard. */
  createdAt?: string
  /**
   * `login` monitors only, all optional. Credentials themselves are never
   * stored here — see `PORTAL_CREDENTIALS` in scripts/monitor.ts.
   */
  /** POST target for the sign-in form, when it differs from `url`. Defaults to `url`. */
  loginUrl?: string
  /**
   * How the credentials are submitted: `form` (application/x-www-form-urlencoded,
   * for a classic server-rendered login form) or `json` (a JSON body, for an
   * API-driven single-page app). Defaults to `form`.
   */
  loginBodyType?: 'form' | 'json'
  /** Field name for the username/login, in the form body or JSON body. Defaults to "username". */
  usernameField?: string
  /** Field name for the password, in the form body or JSON body. Defaults to "password". */
  passwordField?: string
  /** Substring required in the response for a sign-in to count as successful. */
  successText?: string
  /** Substring whose presence in the response marks the sign-in as failed. */
  failureText?: string
}

export interface MonitorsFile {
  monitors: Monitor[]
}

export interface MonitorStatus {
  id: string
  status: Status
  /** HTTP status code of the last check, null when the request never completed. */
  statusCode: number | null
  /** Response time of the last check in milliseconds, null on transport errors. */
  responseTime: number | null
  error: string | null
  /** ISO timestamp of the last check. */
  lastCheck: string
  /** ISO timestamp the monitor entered its current status. */
  since: string
  /** Cumulative counters, kept across history trimming. */
  totalChecks: number
  totalUp: number
  /** Rolling windows computed from history.json. */
  uptime24h: number | null
  uptime7d: number | null
  uptime30d: number | null
  avgResponse24h: number | null
  incidents: number
  /**
   * Value of the `status` field the endpoint last reported, for health monitors
   * whose body carried one. Null everywhere else.
   */
  reported: string | null
}

export interface StatusFile {
  /** ISO timestamp of the last monitoring run that produced this file. */
  updatedAt: string
  /** ISO timestamp of the last run whose results were committed. */
  lastCommitAt: string | null
  monitors: Record<string, MonitorStatus>
}

export interface HistoryEntry {
  timestamp: string
  monitorId: string
  status: Status
  statusCode: number | null
  responseTime: number | null
  error: string | null
}

export interface HistoryFile {
  entries: HistoryEntry[]
}

export interface Incident {
  id: string
  monitorId: string
  /** ISO timestamp of the check that first observed the outage. */
  startedAt: string
  /** ISO timestamp of the check that observed the recovery, null while ongoing. */
  endedAt: string | null
  durationMs: number | null
  status: 'ongoing' | 'resolved'
  /** Details of the failing check that opened the incident. */
  statusCode: number | null
  error: string | null
  /** Number of failed checks observed during the incident. */
  failedChecks: number
  /**
   * When Telegram was last told about this incident — the opening alert, or
   * the most recent reminder. Absent on incidents recorded before reminders
   * existed, where the opening alert is the notice to count from.
   */
  lastNotifiedAt?: string | null
}

export interface IncidentsFile {
  incidents: Incident[]
}

/** Result of a single HTTP probe. */
/**
 * Why a check failed, recorded where the failure happened rather than guessed
 * from the wording afterwards.
 *
 * - `transport` — nothing came back: DNS, TLS, refused, timed out.
 * - `server` — the far end admitted trouble of its own: 5xx, 408, 429.
 * - `verdict` — the far end answered and the answer is a no: 4xx, a rejected
 *   sign-in, a health endpoint reporting trouble.
 * - `config` — this side is misconfigured; asking again changes nothing.
 *
 * The retry policy reads this. It used to read the error text, which meant the
 * messages could not be translated without changing behaviour.
 */
export type FailureKind = 'transport' | 'server' | 'verdict' | 'config'

export interface ProbeResult {
  status: Status
  statusCode: number | null
  responseTime: number | null
  error: string | null
  /** Set whenever `status` is DOWN. */
  failure?: FailureKind | null
  /** Value of the `status` field when the body was JSON with one. */
  reported?: string | null
}

/** Outcome for one monitor in one run. */
export interface CheckResult {
  monitorId: string
  status: Status
  statusCode: number | null
  responseTime: number | null
  error: string | null
  timestamp: string
  reported: string | null
  /** Set whenever `status` is DOWN — see `FailureKind`. */
  failure?: FailureKind | null
}

export type HistoryRange = '24h' | '7d' | '30d'

// --- API response shapes ---------------------------------------------------

export interface MonitorWithState extends Monitor {
  state: MonitorStatus | null
}

export interface StatusResponse {
  updatedAt: string | null
  monitors: MonitorWithState[]
}

export interface MonitorsResponse {
  monitors: Monitor[]
  limit: number
}

export interface HistoryResponse {
  entries: HistoryEntry[]
  total: number
}

export interface IncidentsResponse {
  incidents: Incident[]
}

// --- Telegram subscribers ---------------------------------------------------

/** Someone who sent /start to the bot and now receives alerts. */
export interface Subscriber {
  /** Telegram chat id. Negative for groups. */
  chatId: number
  /** Best-effort label for the log and the dashboard — never used for delivery. */
  label: string
  /** 'private', 'group', 'supergroup', 'channel'. */
  chatType: string
  addedAt: string
}

export interface SubscribersFile {
  /**
   * getUpdates cursor. Telegram only keeps updates for 24 hours and drops the
   * ones already confirmed by a higher offset, so this has to be persisted.
   */
  offset: number
  subscribers: Subscriber[]
}
