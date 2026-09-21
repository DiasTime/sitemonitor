/**
 * Russian wording for everything that reaches Telegram.
 *
 * The dashboard stays in English, so the shared formatters in `lib/utils.ts`
 * do too; these are their Russian counterparts, used only in messages a
 * subscriber reads. The hard part is not translation but agreement: Russian
 * picks a different form of a noun for 1, for 2-4 and for 5 and up, and a
 * monitor that reports "5 часа" reads as broken software.
 */

/** Pick the form that agrees with `count`: [1, 2-4, 5+]. */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(Math.trunc(count))
  const tens = n % 100
  if (tens >= 11 && tens <= 14) return forms[2]
  const ones = n % 10
  if (ones === 1) return forms[0]
  if (ones >= 2 && ones <= 4) return forms[1]
  return forms[2]
}

const SECONDS: [string, string, string] = ['секунда', 'секунды', 'секунд']
const MINUTES: [string, string, string] = ['минута', 'минуты', 'минут']
const HOURS: [string, string, string] = ['час', 'часа', 'часов']
const DAYS: [string, string, string] = ['день', 'дня', 'дней']
const CHECKS: [string, string, string] = ['проверка', 'проверки', 'проверок']

const say = (count: number, forms: [string, string, string]) =>
  `${count} ${plural(count, forms)}`

/** 6000 -> "6 секунд", 3600000 -> "1 час", 90060000 -> "1 день 1 час" */
export function formatDurationRu(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'

  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return say(seconds, SECONDS)

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return say(minutes, MINUTES)

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) {
    return restMinutes ? `${say(hours, HOURS)} ${say(restMinutes, MINUTES)}` : say(hours, HOURS)
  }

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${say(days, DAYS)} ${say(restHours, HOURS)}` : say(days, DAYS)
}

/** 3 -> "3 проверки" */
export function formatChecksRu(count: number): string {
  return say(count, CHECKS)
}

/** 184 -> "184 мс", 2412 -> "2,41 с" */
export function formatResponseTimeRu(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(2).replace('.', ',')} с`
}

/** 99.9134 -> "99,91%" */
export function formatUptimeRu(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(2).replace('.', ',')}%`
}
