import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** `https://example.com/path` -> `example.com` */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** 184 -> "184 ms", 2412 -> "2.41 s" */
export function formatResponseTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** 99.9134 -> "99.91%" */
export function formatUptime(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(2)}%`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

/** Duration in ms -> "6 minutes", "2 hours 5 minutes", "45 seconds" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) {
    const head = `${hours} hour${hours === 1 ? '' : 's'}`
    return restMinutes ? `${head} ${restMinutes} minute${restMinutes === 1 ? '' : 's'}` : head
  }

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  const head = `${days} day${days === 1 ? '' : 's'}`
  return restHours ? `${head} ${restHours} hour${restHours === 1 ? '' : 's'}` : head
}

/** True when the runtime recognises an IANA time zone name. */
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

/**
 * "19 Aug 2026, 15:42 GMT+5" — used in Telegram messages.
 *
 * Alerts are read by a person in one place, so they are rendered in that
 * person's zone rather than the runner's UTC. The zone is always spelled out:
 * a bare time in an alert is worse than useless when it is five hours off.
 */
export function formatFullTimestamp(iso: string, timeZone?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  const requested = timeZone ?? process.env.DISPLAY_TIMEZONE ?? 'UTC'
  const zone = isValidTimeZone(requested) ? requested : 'UTC'

  const formatted = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
    timeZoneName: 'short',
  }).format(date)
  // en-GB renders "19 Aug 2026, 15:42 GMT+5" already; normalise stray commas.
  return formatted.replace(/,\s+/, ', ')
}

/** Full local date and time, for tooltips that disambiguate a bare clock. */
export function formatExact(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })
}

/** "15:36" in the viewer's locale. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "August 19, 15:42" — incident headings. */
export function formatIncidentDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** "3 minutes ago" */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  return `${formatDuration(diff)} ago`
}

/** Stable, URL-safe id derived from a monitor name/url. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
