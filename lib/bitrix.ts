/**
 * Bitrix24 tasks for SSL certificates that are running out.
 *
 * Telegram tells whoever is watching; this hands the work to the people who do
 * it. When a monitor's SSL date (lib/ssl.ts) comes within 7 days, a task goes
 * to the DevOps project, IT Infra Tickets. At 5 and at 3 days the same task
 * gets a comment, rather than a second task appearing beside the first.
 * B24_SSL_DAYS moves those thresholds.
 *
 * One task per host and date. The monitor checks around the clock, so what was
 * filed is remembered in status.json under `sslTasks`: host -> date, task id,
 * last threshold reported. Entering the new date after a renewal starts the
 * cycle over. That record can be lost — a run whose commit loses a rebase gives
 * the commit up — so before filing a task the project's open tasks are searched
 * for one about the same host, and that one is used instead.
 *
 * The decisions are pure (`planSslTasks`) so they can be tested without a
 * clock or a portal; `syncSslTasks` carries them out through a client.
 */

import { numberFromEnv } from './env'
import { formatDateRu, formatDaysLeftRu } from './ru'
import { sslDaysLeft } from './ssl'
import type { Monitor, SslTaskRecord } from './types'
import { hostnameOf } from './utils'

/** Days before expiry: a task at the first, a comment on it at each of the rest. */
export const DEFAULT_SSL_TASK_DAYS = [7, 5, 3]
/** IT Infra Tickets. */
export const DEFAULT_B24_GROUP_ID = 4272
/** The task falls due this many days before the certificate runs out. */
const DEADLINE_LEAD_DAYS = 3
const DEADLINE_TIME = '18:00:00'
/** Bitrix24 task status "completed". */
const STATUS_COMPLETED = 5
const PRIORITY_HIGH = 2
const REQUEST_TIMEOUT_MS = 15_000
const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface Bitrix24Config {
  /** Inbound webhook, ending in "/": https://portal/rest/<user>/<key>/. A secret — the key is in it. */
  webhookUrl: string
  /** The project (workgroup) tasks are filed in. */
  groupId: number
  /** Who the task is assigned to. */
  responsibleId: number
}

/**
 * Settings from the environment. No config and no problem means the feature
 * is simply off; a problem means it was meant to be on and cannot be.
 */
export function bitrix24FromEnv(
  env: Record<string, string | undefined> = process.env,
): { config: Bitrix24Config | null; problem?: string } {
  const url = env.B24_WEBHOOK_URL?.trim()
  if (!url) return { config: null }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { config: null, problem: 'B24_WEBHOOK_URL is not a URL' }
  }
  if (parsed.protocol !== 'https:') {
    return { config: null, problem: 'B24_WEBHOOK_URL must be https — the webhook key is part of it' }
  }

  const responsibleId = Number(env.B24_RESPONSIBLE_ID?.trim() || Number.NaN)
  if (!Number.isInteger(responsibleId) || responsibleId <= 0) {
    return { config: null, problem: 'B24_RESPONSIBLE_ID is not set, so there is nobody to assign the task to' }
  }

  const groupId = numberFromEnv('B24_GROUP_ID', DEFAULT_B24_GROUP_ID, env)
  if (!Number.isInteger(groupId)) return { config: null, problem: 'B24_GROUP_ID is not a whole number' }

  return {
    config: { webhookUrl: url.endsWith('/') ? url : `${url}/`, groupId, responsibleId },
  }
}

/** "7,5,3" -> [7, 5, 3], latest last. Blank or unreadable gives the default. */
export function parseSslTaskDays(raw: string | undefined): number[] {
  const days = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number)
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0)) {
    return [...DEFAULT_SSL_TASK_DAYS]
  }
  return [...new Set(days)].sort((a, b) => b - a)
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/** The latest threshold `daysLeft` has reached, or null while it is further out than all of them. */
export function sslTaskStage(daysLeft: number, days: number[]): number | null {
  let stage: number | null = null
  for (const day of days) {
    if (daysLeft <= day && (stage === null || day < stage)) stage = day
  }
  return stage
}

/** One certificate: what a task or a comment is about. */
export interface SslTaskTarget {
  host: string
  expiresAt: string
  daysLeft: number
  /** The enabled monitors on this host, for the task description. */
  monitors: { name: string; url: string }[]
}

export type SslTaskAction =
  | { kind: 'create'; target: SslTaskTarget; stage: number }
  | { kind: 'comment'; target: SslTaskTarget; stage: number; taskId: number }

export interface SslTaskPlan {
  /** Records still current, by host — what is kept if every action fails. */
  records: Record<string, SslTaskRecord>
  actions: SslTaskAction[]
}

/**
 * What this run owes Bitrix24.
 *
 * Monitors are grouped by host, since two monitors on one site share one
 * certificate and so one task. A paused monitor files nothing but keeps its
 * record, so resuming it does not file the same task again. A record whose
 * date no longer matches the monitor's is dropped: the certificate it was
 * about has been replaced.
 */
export function planSslTasks(
  monitors: Monitor[],
  previous: Record<string, SslTaskRecord>,
  now: number,
  options: { days: number[]; timeZone?: string },
): SslTaskPlan {
  const byHost = new Map<string, Monitor[]>()
  for (const monitor of monitors) {
    if (!monitor.sslExpiresAt || sslDaysLeft(monitor.sslExpiresAt, now) === null) continue
    const host = hostnameOf(monitor.url).toLowerCase()
    byHost.set(host, [...(byHost.get(host) ?? []), monitor])
  }

  const records: Record<string, SslTaskRecord> = {}
  const actions: SslTaskAction[] = []

  for (const [host, onHost] of byHost) {
    const last = previous[host]
    const enabled = onHost.filter((monitor) => monitor.enabled !== false)
    if (!enabled.length) {
      if (last && onHost.some((monitor) => monitor.sslExpiresAt === last.expiresAt)) {
        records[host] = last
      }
      continue
    }

    // Two dates for one host: the earlier one is the one that can bite.
    const expiresAt = enabled.map((monitor) => monitor.sslExpiresAt as string).sort()[0]
    const daysLeft = sslDaysLeft(expiresAt, now, options.timeZone) as number
    const current = last?.expiresAt === expiresAt ? last : undefined
    if (current) records[host] = current

    const stage = sslTaskStage(daysLeft, options.days)
    if (stage === null) continue

    const target: SslTaskTarget = {
      host,
      expiresAt,
      daysLeft,
      monitors: enabled.map(({ name, url }) => ({ name, url })),
    }
    if (!current) actions.push({ kind: 'create', target, stage })
    else if (stage < current.stage) {
      actions.push({ kind: 'comment', target, stage, taskId: current.taskId })
    }
  }

  return { records, actions }
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** Every title starts with this, which is how an open task about a host is found again. */
function titlePrefix(host: string): string {
  return `SSL: сертификат ${host} `
}

/** "SSL: сертификат example.kz истекает через 30 дн." */
export function sslTaskTitle(host: string, daysLeft: number): string {
  if (daysLeft > 0) return `${titlePrefix(host)}истекает через ${daysLeft} дн.`
  if (daysLeft === 0) return `${titlePrefix(host)}истекает сегодня`
  return `${titlePrefix(host)}истёк`
}

export function sslTaskDescription(target: SslTaskTarget): string {
  return [
    `Домен: ${target.host}`,
    `Срок действия до: ${formatDateRu(target.expiresAt)} (${formatDaysLeftRu(target.daysLeft)})`,
    '',
    target.monitors.length === 1 ? 'Монитор:' : 'Мониторы:',
    ...target.monitors.map((monitor) => `${monitor.name} — ${monitor.url}`),
    '',
    'Нужно перевыпустить и установить сертификат.',
    'После продления соббшите мне и я обновлю данные на мониторинге.',
    '',
    'Задача создана автоматически сервисом мониторинга.',
  ].join('\n')
}

export function sslTaskComment(target: SslTaskTarget): string {
  const state =
    target.daysLeft > 0
      ? `истекает ${formatDaysLeftRu(target.daysLeft)}`
      : target.daysLeft === 0
        ? 'истекает сегодня'
        : `истёк ${formatDaysLeftRu(target.daysLeft)}`
  return [
    `Напоминание: SSL-сертификат ${target.host} ${state} (${formatDateRu(target.expiresAt)}).`,
    'Если сертификат уже продлён, соббшите мне и я обновлю данные на мониторинге.',
  ].join('\n')
}

/** "+05:00" for Asia/Almaty at `at`. An unknown zone counts as UTC, as it does for "today". */
function utcOffset(at: number, timeZone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    const match = /([+-]\d{2}):?(\d{2})/.exec(name ?? '')
    return match ? `${match[1]}:${match[2]}` : '+00:00'
  } catch {
    return '+00:00'
  }
}

/**
 * DEADLINE: end of the working day three days before expiry, in `timeZone`.
 * A certificate closer than that is due today — a deadline already behind
 * the task the moment it is filed would only read as overdue.
 */
export function sslTaskDeadline(expiresAt: string, daysLeft: number, timeZone = 'UTC'): string {
  const [year, month, day] = expiresAt.split('-').map(Number)
  const due = Date.UTC(year, month - 1, day) - Math.min(DEADLINE_LEAD_DAYS, daysLeft) * DAY_MS
  const date = new Date(due).toISOString().slice(0, 10)
  return `${date}T${DEADLINE_TIME}${utcOffset(due + 18 * 3600_000, timeZone)}`
}

// ---------------------------------------------------------------------------
// Talking to the portal
// ---------------------------------------------------------------------------

/**
 * A call that did not go through. `fatal` when the portal itself is out of
 * reach or refuses the webhook, so every other call this run would fail too.
 */
export class Bitrix24Error extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message)
    this.name = 'Bitrix24Error'
  }
}

export interface Bitrix24Client {
  /** An open task in the project about `host`, if there is one. */
  findOpenTask(host: string): Promise<number | null>
  createTask(target: SslTaskTarget): Promise<number>
  addComment(taskId: number, text: string): Promise<void>
  /** Open SSL tasks in the project — a read-only call that proves the webhook works. */
  countOpenSslTasks(): Promise<number>
}

interface Bitrix24Response<T> {
  result?: T
  error?: string
  error_description?: string
}

interface TaskListResult {
  tasks?: { id?: string | number; title?: string }[]
}

export function bitrix24Client(
  config: Bitrix24Config,
  options: { timeZone?: string; fetch?: typeof fetch } = {},
): Bitrix24Client {
  const doFetch = options.fetch ?? fetch

  /** Never quotes the URL in an error: the webhook key is part of it. */
  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    let body: Bitrix24Response<T> | null
    try {
      response = await doFetch(`${config.webhookUrl}${method}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      })
      body = (await response.json().catch(() => null)) as Bitrix24Response<T> | null
    } catch (error) {
      const reason = controller.signal.aborted ? 'timed out' : (error as Error).message
      throw new Bitrix24Error(`${method}: ${reason}`, true)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok || !body || body.error || body.result === undefined) {
      const reason = body?.error_description || body?.error || `HTTP ${response.status}`
      // A bad or revoked key, a missing scope, the portal down.
      const fatal = response.status === 401 || response.status === 403 || response.status >= 500
      throw new Bitrix24Error(`${method}: ${reason}`.replace(/\s+/g, ' '), fatal)
    }
    return body.result
  }

  const openTasks = (title: string) =>
    call<TaskListResult>('tasks.task.list', {
      filter: { GROUP_ID: config.groupId, '%TITLE': title, '!STATUS': STATUS_COMPLETED },
      select: ['ID', 'TITLE'],
      order: { ID: 'desc' },
    })

  return {
    async findOpenTask(host) {
      const prefix = titlePrefix(host)
      const result = await openTasks(prefix.trim())
      // %TITLE matches a substring: "a.kz" would also find "a.kz.example".
      const task = (result.tasks ?? []).find((entry) => entry.title?.startsWith(prefix))
      const id = Number(task?.id)
      return Number.isInteger(id) && id > 0 ? id : null
    },

    async createTask(target) {
      const result = await call<{ task?: { id?: string | number } }>('tasks.task.add', {
        fields: {
          TITLE: sslTaskTitle(target.host, target.daysLeft),
          DESCRIPTION: sslTaskDescription(target),
          GROUP_ID: config.groupId,
          RESPONSIBLE_ID: config.responsibleId,
          DEADLINE: sslTaskDeadline(target.expiresAt, target.daysLeft, options.timeZone),
          PRIORITY: PRIORITY_HIGH,
          TAGS: ['ssl', 'monitoring'],
        },
      })
      const id = Number(result.task?.id)
      if (!Number.isInteger(id) || id <= 0) {
        throw new Bitrix24Error('tasks.task.add: the answer carried no task id', false)
      }
      return id
    },

    async addComment(taskId, text) {
      await call('task.commentitem.add', { TASKID: taskId, FIELDS: { POST_MESSAGE: text } })
    },

    async countOpenSslTasks() {
      const result = await openTasks('SSL: сертификат')
      return result.tasks?.length ?? 0
    },
  }
}

// ---------------------------------------------------------------------------
// Doing
// ---------------------------------------------------------------------------

/**
 * Carry out the plan; returns the records to keep. A failed action leaves its
 * record as it was, so the next run tries again. A fatal failure stops the
 * rest — each further call would only wait out the same timeout.
 */
export async function syncSslTasks(
  plan: SslTaskPlan,
  client: Bitrix24Client,
  log: (line: string) => void,
): Promise<Record<string, SslTaskRecord>> {
  const records = { ...plan.records }

  for (const action of plan.actions) {
    const { host, expiresAt, daysLeft } = action.target
    const about = `${host} (${expiresAt}, ${daysLeft} day(s) left)`
    try {
      if (action.kind === 'comment') {
        await client.addComment(action.taskId, sslTaskComment(action.target))
        records[host] = { expiresAt, taskId: action.taskId, stage: action.stage }
        log(`  Bitrix24: comment on task #${action.taskId} — ${about}`)
        continue
      }

      // The record of a task filed earlier can be lost with a commit, and an
      // older task may still be open: either way, that is where this goes.
      const open = await client.findOpenTask(host)
      if (open) {
        await client.addComment(open, sslTaskComment(action.target))
        records[host] = { expiresAt, taskId: open, stage: action.stage }
        log(`  Bitrix24: task #${open} is already open, commented — ${about}`)
        continue
      }

      const taskId = await client.createTask(action.target)
      records[host] = { expiresAt, taskId, stage: action.stage }
      log(`  Bitrix24: task #${taskId} created — ${about}`)
    } catch (error) {
      const failure =
        error instanceof Bitrix24Error ? error : new Bitrix24Error((error as Error).message, true)
      log(`  Bitrix24: ${host} not filed, will retry next run — ${failure.message}`)
      if (failure.fatal) break
      // The portal answered but refused this task — most likely it was
      // deleted. Forget it, so the next run looks for an open one or files a
      // fresh one instead of failing on this one forever.
      if (action.kind === 'comment') delete records[host]
    }
  }

  return records
}
