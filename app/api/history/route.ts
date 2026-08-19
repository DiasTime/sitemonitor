import { errorResponse, jsonResponse } from '@/lib/api'
import { getHistory, isHistoryRange, selectHistory } from '@/lib/storage'
import { isValidMonitorId } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LIMIT = 5000

/**
 * GET /api/history?monitorId=&range=24h|7d|30d&limit=
 * Returns raw check samples, oldest first.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const monitorId = url.searchParams.get('monitorId') ?? undefined
  const rangeParam = url.searchParams.get('range')
  const limitParam = url.searchParams.get('limit')

  if (monitorId && !isValidMonitorId(monitorId)) {
    return jsonResponse({ error: 'Invalid monitorId' }, { status: 400 })
  }
  if (rangeParam && !isHistoryRange(rangeParam)) {
    return jsonResponse({ error: 'range must be one of 24h, 7d, 30d' }, { status: 400 })
  }
  const range = isHistoryRange(rangeParam) ? rangeParam : undefined

  const parsedLimit = limitParam ? Number(limitParam) : NaN
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(1, Math.trunc(parsedLimit)), MAX_LIMIT)
    : MAX_LIMIT

  try {
    const { entries } = await getHistory()
    const selected = selectHistory(entries, { monitorId, range, limit })
    return jsonResponse({ entries: selected, total: selected.length })
  } catch (error) {
    return errorResponse(error)
  }
}
