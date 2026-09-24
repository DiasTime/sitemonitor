/**
 * SSL certificate expiry, from a date someone typed in.
 *
 * The date is entered by hand on the monitor rather than read off the
 * certificate: it is what the person renewing the certificate knows, and it
 * works the same for every kind of monitor. What this module decides is how
 * far away that date is and when Telegram should hear about it — once when
 * the warning window opens, once more on the day itself.
 *
 * Kept free of I/O so the script and the dashboard agree, and so it can be
 * tested without a clock.
 */

/** How many days ahead the first warning goes out. */
export const DEFAULT_SSL_WARNING_DAYS = 5

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** "2026-10-01" -> days since the epoch, or null when it is not a real date. */
function dayNumberOf(date: string): number | null {
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const time = Date.UTC(year, month - 1, day)
  const check = new Date(time)
  // Date.UTC rolls 2026-02-31 over into March; a date that does not survive
  // the round trip was never a date.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null
  }
  return time / DAY_MS
}

/** Today's calendar date in `timeZone` (the runtime's own zone when absent), as a day number. */
function todayIn(now: number, timeZone?: string): number {
  let parts: string
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    // An unknown zone name: fall back to UTC rather than skip the warning.
    parts = new Date(now).toISOString().slice(0, 10)
  }
  return dayNumberOf(parts) ?? Math.floor(now / DAY_MS)
}

/** Validate the optional expiry date from the dashboard form. Blank clears it. */
export function validateSslDate(raw: unknown): { ok: boolean; date?: string; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, date: undefined }
  if (typeof raw !== 'string') return { ok: false, error: 'SSL expiry date must be a string' }
  const date = raw.trim()
  const day = dayNumberOf(date)
  if (day === null) return { ok: false, error: 'SSL expiry date must be a date like 2026-10-01' }
  // Guard against a typo'd year rather than any real certificate lifetime.
  const year = Number(date.slice(0, 4))
  if (year < 2000 || year > 2100) return { ok: false, error: 'SSL expiry date is out of range' }
  return { ok: true, date }
}

/**
 * Whole calendar days from today until `expiresAt`: 0 on the day itself,
 * negative once it has passed, null when the date is unreadable.
 */
export function sslDaysLeft(expiresAt: string, now: number, timeZone?: string): number | null {
  const expiry = dayNumberOf(expiresAt)
  if (expiry === null) return null
  return expiry - todayIn(now, timeZone)
}

/** `soon` inside the warning window, `expired` from the day itself on, null while it is fine. */
export type SslStage = 'soon' | 'expired'

export function sslStage(daysLeft: number, warningDays: number = DEFAULT_SSL_WARNING_DAYS): SslStage | null {
  if (daysLeft <= 0) return 'expired'
  if (daysLeft <= warningDays) return 'soon'
  return null
}

export interface SslNotice {
  stage: SslStage
  daysLeft: number
  /** What to remember as sent, so the same notice does not go out every run. */
  key: string
}

/**
 * The Telegram notice this run owes, if any.
 *
 * `lastKey` is the key of the notice already sent for this monitor. It names
 * the date as well as the stage, so entering a new date after a renewal starts
 * the cycle over, and a date that is already inside the window when it is
 * entered is announced straight away.
 */
export function sslNoticeDue(
  expiresAt: string,
  lastKey: string | undefined,
  now: number,
  options: { warningDays?: number; timeZone?: string } = {},
): SslNotice | null {
  const daysLeft = sslDaysLeft(expiresAt, now, options.timeZone)
  if (daysLeft === null) return null
  const stage = sslStage(daysLeft, options.warningDays)
  if (!stage) return null
  const key = `${expiresAt}:${stage}`
  if (key === lastKey) return null
  return { stage, daysLeft, key }
}

/** Whether `key` is a notice about this exact date — worth keeping across runs. */
export function isNoticeFor(expiresAt: string, key: string | undefined): boolean {
  return typeof key === 'string' && key.startsWith(`${expiresAt}:`)
}

/** Dashboard wording: "SSL in 12 days", "SSL expires today", "SSL expired 3 days ago". */
export function describeSslDaysLeft(daysLeft: number): string {
  if (daysLeft === 0) return 'SSL expires today'
  if (daysLeft === 1) return 'SSL expires tomorrow'
  if (daysLeft > 1) return `SSL in ${daysLeft} days`
  const ago = -daysLeft
  return `SSL expired ${ago} day${ago === 1 ? '' : 's'} ago`
}
