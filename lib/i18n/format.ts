import { intlLocale, type Locale } from '@/lib/i18n/config'
import { formatDurationRu, formatResponseTimeRu, formatUptimeRu } from '@/lib/ru'
import {
  formatDuration,
  formatExact,
  formatNumber,
  formatResponseTime,
  formatUptime,
} from '@/lib/utils'

/**
 * Locale-aware versions of the display formatters in lib/utils. The English
 * branch calls the originals, so English output is unchanged; the Russian one
 * reuses the forms already written for Telegram in lib/ru.
 */
export function createFormatters(locale: Locale) {
  const ru = locale === 'ru'
  const tag = intlLocale(locale)

  const duration = (ms: number | null | undefined) =>
    ru ? formatDurationRu(ms) : formatDuration(ms)

  return {
    responseTime: (ms: number | null | undefined) =>
      ru ? formatResponseTimeRu(ms) : formatResponseTime(ms),
    uptime: (value: number | null | undefined) => (ru ? formatUptimeRu(value) : formatUptime(value)),
    number: (value: number) =>
      ru ? new Intl.NumberFormat('ru-RU').format(value) : formatNumber(value),
    duration,

    /** "3 minutes ago" / "3 минуты назад" */
    relative(iso: string | null | undefined): string {
      const then = iso ? new Date(iso).getTime() : NaN
      if (Number.isNaN(then)) return ru ? 'никогда' : 'never'
      const diff = Date.now() - then
      if (diff < 60_000) return ru ? 'только что' : 'just now'
      return ru ? `${duration(diff)} назад` : `${duration(diff)} ago`
    },

    /** "15:36" */
    clock(iso: string | null | undefined): string {
      const date = iso ? new Date(iso) : null
      if (!date || Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', hour12: false })
    },

    /** "August 19, 15:42" / "19 августа, 15:42" */
    incidentDate(iso: string): string {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return iso
      return date.toLocaleString(tag, {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    },

    /** Full date and time, for tooltips and "down since". */
    exact(iso: string | null | undefined): string | undefined {
      if (!ru) return formatExact(iso)
      if (!iso) return undefined
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return undefined
      return date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'long' })
    },

    /** A calendar date such as an SSL expiry, which carries no time zone. */
    calendarDate(date: string): string {
      const time = Date.parse(`${date}T00:00:00Z`)
      if (Number.isNaN(time)) return date
      return new Date(time).toLocaleDateString(tag, { timeZone: 'UTC', dateStyle: 'medium' })
    },

    /** Axis and tooltip labels on the response-time chart. */
    chartLabel(time: number, showDate: boolean): string {
      return new Date(time).toLocaleString(tag, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(showDate ? { month: 'short', day: 'numeric' } : {}),
      })
    },
  }
}

export type Formatters = ReturnType<typeof createFormatters>
