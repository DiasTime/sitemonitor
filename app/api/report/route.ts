import { errorResponse, jsonResponse } from '@/lib/api'
import { buildReport, isTimeZone, MAX_REPORT_DAYS } from '@/lib/report'
import { getHistory, getIncidents, getMonitors } from '@/lib/storage'
import { isValidMonitorId } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/report?from=&to=&monitorId=&tz=
 * The uptime report for a period, as data; the dashboard draws the PDF from it.
 * `from` and `to` are ISO timestamps, `tz` the viewer's IANA zone for day lines.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const from = Date.parse(url.searchParams.get('from') ?? '')
  const to = Date.parse(url.searchParams.get('to') ?? '')
  const monitorId = url.searchParams.get('monitorId') || null
  const tzParam = url.searchParams.get('tz')
  const now = Date.now()

  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return jsonResponse({ error: 'from and to must be ISO timestamps' }, { status: 400 })
  }
  if (from >= Math.min(to, now)) {
    return jsonResponse({ error: 'The period must start before it ends, and not in the future' }, { status: 400 })
  }
  if (to - from > MAX_REPORT_DAYS * 24 * 3600_000) {
    return jsonResponse({ error: `A report can cover at most ${MAX_REPORT_DAYS} days` }, { status: 400 })
  }
  if (monitorId && !isValidMonitorId(monitorId)) {
    return jsonResponse({ error: 'Invalid monitorId' }, { status: 400 })
  }
  if (tzParam && !isTimeZone(tzParam)) {
    return jsonResponse({ error: 'Unknown time zone' }, { status: 400 })
  }

  try {
    const [{ monitors }, { incidents }, { entries }] = await Promise.all([
      getMonitors(),
      getIncidents(),
      getHistory(),
    ])
    if (monitorId && !monitors.some((monitor) => monitor.id === monitorId)) {
      return jsonResponse({ error: 'Monitor not found' }, { status: 404 })
    }

    const report = buildReport({
      monitors,
      incidents,
      history: entries,
      from,
      to,
      now,
      timeZone: tzParam || 'UTC',
      monitorId,
    })
    return jsonResponse(report)
  } catch (error) {
    return errorResponse(error)
  }
}
