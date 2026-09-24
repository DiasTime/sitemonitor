import 'server-only'

import { readJsonFile, updateJsonFile } from '@/lib/github'
import {
  isValidMonitorId,
  validateFieldName,
  validateMatchText,
  validateMonitorName,
  validateMonitorUrl,
} from '@/lib/security'
import { validateSslDate } from '@/lib/ssl'
import { hostnameOf, slugify } from '@/lib/utils'
import type {
  HistoryEntry,
  HistoryFile,
  HistoryRange,
  IncidentsFile,
  Monitor,
  MonitorsFile,
  MonitorType,
  StatusFile,
} from '@/lib/types'

/** Every piece of state the tool keeps lives in one of these four files. */
export const DATA_PATHS = {
  monitors: 'data/monitors.json',
  status: 'data/status.json',
  history: 'data/history.json',
  incidents: 'data/incidents.json',
  subscribers: 'data/subscribers.json',
} as const

/** Hard cap for a single deployment — see the limits section of the README. */
export const MAX_MONITORS = 30

export const EMPTY_MONITORS: MonitorsFile = { monitors: [] }
export const EMPTY_STATUS: StatusFile = { updatedAt: '', lastCommitAt: null, monitors: {} }
export const EMPTY_HISTORY: HistoryFile = { entries: [] }
export const EMPTY_INCIDENTS: IncidentsFile = { incidents: [] }

export async function getMonitors(): Promise<MonitorsFile> {
  const { data } = await readJsonFile<MonitorsFile>(DATA_PATHS.monitors, EMPTY_MONITORS)
  return { monitors: Array.isArray(data.monitors) ? data.monitors : [] }
}

export async function getStatus(): Promise<StatusFile> {
  const { data } = await readJsonFile<StatusFile>(DATA_PATHS.status, EMPTY_STATUS)
  return { ...EMPTY_STATUS, ...data, monitors: data.monitors ?? {} }
}

export async function getHistory(): Promise<HistoryFile> {
  const { data } = await readJsonFile<HistoryFile>(DATA_PATHS.history, EMPTY_HISTORY)
  return { entries: Array.isArray(data.entries) ? data.entries : [] }
}

export async function getIncidents(): Promise<IncidentsFile> {
  const { data } = await readJsonFile<IncidentsFile>(DATA_PATHS.incidents, EMPTY_INCIDENTS)
  return { incidents: Array.isArray(data.incidents) ? data.incidents : [] }
}

export const RANGE_HOURS: Record<HistoryRange, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

export function isHistoryRange(value: unknown): value is HistoryRange {
  return value === '24h' || value === '7d' || value === '30d'
}

/** Filter history to one monitor and one time window, oldest first. */
export function selectHistory(
  entries: HistoryEntry[],
  options: { monitorId?: string; range?: HistoryRange; limit?: number } = {},
): HistoryEntry[] {
  const { monitorId, range, limit } = options
  const cutoff = range ? Date.now() - RANGE_HOURS[range] * 3600_000 : null

  const selected = entries.filter((entry) => {
    if (monitorId && entry.monitorId !== monitorId) return false
    if (cutoff !== null) {
      const time = new Date(entry.timestamp).getTime()
      if (!Number.isFinite(time) || time < cutoff) return false
    }
    return true
  })

  selected.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return limit && selected.length > limit ? selected.slice(-limit) : selected
}

function uniqueId(base: string, taken: Set<string>): string {
  const root = base || 'monitor'
  if (!taken.has(root)) return root
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`.slice(0, 64)
    if (!taken.has(candidate)) return candidate
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 64)
}

export interface AddMonitorInput {
  url: unknown
  name?: unknown
  /** 'website' (default), 'health' or 'login'. */
  type?: unknown
  /** 'login' monitors only — see the matching fields on `Monitor`. */
  loginUrl?: unknown
  loginBodyType?: unknown
  usernameField?: unknown
  passwordField?: unknown
  successText?: unknown
  failureText?: unknown
  /** Any type — "YYYY-MM-DD", blank to clear. */
  sslExpiresAt?: unknown
}

export type MutationResult =
  | { ok: true; monitor: Monitor }
  | { ok: false; error: string; status: number }

type LoginFields = Pick<
  Monitor,
  'loginUrl' | 'loginBodyType' | 'usernameField' | 'passwordField' | 'successText' | 'failureText'
>

/** Everything about a monitor that the dashboard form controls. */
type MonitorFields = Pick<Monitor, 'name' | 'url' | 'sslExpiresAt'> & {
  type: MonitorType
  loginFields: LoginFields
}

/** Validate the form fields shared by adding and editing a monitor. */
function validateMonitorInput(
  input: AddMonitorInput,
): { ok: true; fields: MonitorFields } | { ok: false; error: string; status: number } {
  const urlCheck = validateMonitorUrl(input.url)
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error!, status: 400 }
  const url = urlCheck.url!

  const rawName =
    typeof input.name === 'string' && input.name.trim() ? input.name : hostnameOf(url)
  const nameCheck = validateMonitorName(rawName)
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error!, status: 400 }
  const name = nameCheck.name!

  if (
    input.type !== undefined &&
    input.type !== 'website' &&
    input.type !== 'health' &&
    input.type !== 'login'
  ) {
    return { ok: false, error: 'type must be "website", "health" or "login"', status: 400 }
  }
  const type: MonitorType =
    input.type === 'health' ? 'health' : input.type === 'login' ? 'login' : 'website'

  const sslCheck = validateSslDate(input.sslExpiresAt)
  if (!sslCheck.ok) return { ok: false, error: sslCheck.error!, status: 400 }
  const sslExpiresAt = sslCheck.date

  let loginFields: LoginFields = {}
  if (type === 'login') {
    const loginUrlCheck =
      input.loginUrl === undefined || input.loginUrl === '' || input.loginUrl === null
        ? { ok: true as const, url: undefined }
        : validateMonitorUrl(input.loginUrl)
    if (!loginUrlCheck.ok) return { ok: false, error: `Login URL: ${loginUrlCheck.error}`, status: 400 }

    if (
      input.loginBodyType !== undefined &&
      input.loginBodyType !== '' &&
      input.loginBodyType !== 'form' &&
      input.loginBodyType !== 'json'
    ) {
      return { ok: false, error: 'loginBodyType must be "form" or "json"', status: 400 }
    }
    const loginBodyType = input.loginBodyType === 'json' ? 'json' : undefined

    const usernameFieldCheck = validateFieldName(input.usernameField, 'Username field')
    if (!usernameFieldCheck.ok) return { ok: false, error: usernameFieldCheck.error!, status: 400 }
    const passwordFieldCheck = validateFieldName(input.passwordField, 'Password field')
    if (!passwordFieldCheck.ok) return { ok: false, error: passwordFieldCheck.error!, status: 400 }
    const successTextCheck = validateMatchText(input.successText, 'Success text')
    if (!successTextCheck.ok) return { ok: false, error: successTextCheck.error!, status: 400 }
    const failureTextCheck = validateMatchText(input.failureText, 'Failure text')
    if (!failureTextCheck.ok) return { ok: false, error: failureTextCheck.error!, status: 400 }

    loginFields = {
      ...(loginUrlCheck.url ? { loginUrl: loginUrlCheck.url } : {}),
      ...(loginBodyType ? { loginBodyType } : {}),
      ...(usernameFieldCheck.name ? { usernameField: usernameFieldCheck.name } : {}),
      ...(passwordFieldCheck.name ? { passwordField: passwordFieldCheck.name } : {}),
      ...(successTextCheck.text ? { successText: successTextCheck.text } : {}),
      ...(failureTextCheck.text ? { failureText: failureTextCheck.text } : {}),
    }
  }

  return { ok: true, fields: { name, url, type, loginFields, sslExpiresAt } }
}

/** Validate and append a monitor to `data/monitors.json`. */
export async function addMonitor(input: AddMonitorInput): Promise<MutationResult> {
  const validation = validateMonitorInput(input)
  if (!validation.ok) return validation
  const { name, url, type, loginFields, sslExpiresAt } = validation.fields

  let created: Monitor | null = null
  let failure: { error: string; status: number } | null = null

  await updateJsonFile<MonitorsFile>(
    DATA_PATHS.monitors,
    EMPTY_MONITORS,
    (current) => {
      created = null
      failure = null
      const monitors = Array.isArray(current.monitors) ? current.monitors : []

      if (monitors.length >= MAX_MONITORS) {
        failure = { error: `This deployment is limited to ${MAX_MONITORS} monitors`, status: 400 }
        return null
      }
      if (monitors.some((monitor) => monitor.url === url)) {
        failure = { error: 'This URL is already being monitored', status: 409 }
        return null
      }

      const taken = new Set(monitors.map((monitor) => monitor.id))
      const monitor: Monitor = {
        id: uniqueId(slugify(hostnameOf(url)) || slugify(name), taken),
        name,
        url,
        enabled: true,
        ...(type !== 'website' ? { type } : {}),
        ...loginFields,
        ...(sslExpiresAt ? { sslExpiresAt } : {}),
        createdAt: new Date().toISOString(),
      }
      created = monitor
      return { monitors: [...monitors, monitor] }
    },
    `chore(monitors): add ${type === 'health' ? 'health check' : type === 'login' ? 'login check' : 'website'} ${name}`,
  )

  if (failure) return { ok: false, ...(failure as { error: string; status: number }) }
  if (!created) return { ok: false, error: 'Monitor could not be created', status: 500 }
  return { ok: true, monitor: created }
}

/** Field-by-field equality, so a key order difference in the file is not a change. */
function sameMonitor(a: Monitor, b: Monitor): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Monitor)[])
  return [...keys].every((key) => a[key] === b[key])
}

/**
 * Replace a monitor's settings. The id is kept, so its history, incidents and
 * `PORTAL_CREDENTIALS` entry stay attached; `enabled` and `createdAt` are kept too.
 */
export async function updateMonitor(id: string, input: AddMonitorInput): Promise<MutationResult> {
  if (!isValidMonitorId(id)) return { ok: false, error: 'Invalid monitor id', status: 400 }

  const validation = validateMonitorInput(input)
  if (!validation.ok) return validation
  const { name, url, type, loginFields, sslExpiresAt } = validation.fields

  let updated: Monitor | null = null
  let failure: { error: string; status: number } | null = null

  await updateJsonFile<MonitorsFile>(
    DATA_PATHS.monitors,
    EMPTY_MONITORS,
    (current) => {
      updated = null
      failure = null
      const monitors = Array.isArray(current.monitors) ? current.monitors : []
      const match = monitors.find((monitor) => monitor.id === id)
      if (!match) {
        failure = { error: 'Monitor not found', status: 404 }
        return null
      }
      if (monitors.some((monitor) => monitor.id !== id && monitor.url === url)) {
        failure = { error: 'This URL is already being monitored', status: 409 }
        return null
      }

      const next: Monitor = {
        id: match.id,
        name,
        url,
        enabled: match.enabled,
        ...(type !== 'website' ? { type } : {}),
        ...loginFields,
        ...(sslExpiresAt ? { sslExpiresAt } : {}),
        ...(match.createdAt ? { createdAt: match.createdAt } : {}),
      }
      updated = next
      if (sameMonitor(next, match)) return null
      return { monitors: monitors.map((monitor) => (monitor.id === id ? next : monitor)) }
    },
    `chore(monitors): edit ${id}`,
  )

  if (failure) return { ok: false, ...(failure as { error: string; status: number }) }
  if (!updated) return { ok: false, error: 'Monitor could not be updated', status: 500 }
  return { ok: true, monitor: updated }
}

/** Remove a monitor. Its status/history/incident rows are pruned by the next monitoring run. */
export async function removeMonitor(id: string): Promise<MutationResult> {
  if (!isValidMonitorId(id)) return { ok: false, error: 'Invalid monitor id', status: 400 }

  let removed: Monitor | null = null

  await updateJsonFile<MonitorsFile>(
    DATA_PATHS.monitors,
    EMPTY_MONITORS,
    (current) => {
      removed = null
      const monitors = Array.isArray(current.monitors) ? current.monitors : []
      const match = monitors.find((monitor) => monitor.id === id)
      if (!match) return null
      removed = match
      return { monitors: monitors.filter((monitor) => monitor.id !== id) }
    },
    `chore(monitors): remove ${id}`,
  )

  if (!removed) return { ok: false, error: 'Monitor not found', status: 404 }
  return { ok: true, monitor: removed }
}

/** Pause or resume a monitor without deleting its history. */
export async function setMonitorEnabled(id: string, enabled: boolean): Promise<MutationResult> {
  if (!isValidMonitorId(id)) return { ok: false, error: 'Invalid monitor id', status: 400 }

  let updated: Monitor | null = null
  let found = false

  await updateJsonFile<MonitorsFile>(
    DATA_PATHS.monitors,
    EMPTY_MONITORS,
    (current) => {
      updated = null
      found = false
      const monitors = Array.isArray(current.monitors) ? current.monitors : []
      const match = monitors.find((monitor) => monitor.id === id)
      if (!match) return null
      found = true
      if (match.enabled === enabled) {
        updated = match
        return null
      }
      const next = { ...match, enabled }
      updated = next
      return { monitors: monitors.map((monitor) => (monitor.id === id ? next : monitor)) }
    },
    `chore(monitors): ${enabled ? 'resume' : 'pause'} ${id}`,
  )

  if (!found) return { ok: false, error: 'Monitor not found', status: 404 }
  return { ok: true, monitor: updated! }
}
