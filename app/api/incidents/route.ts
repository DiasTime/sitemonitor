import { errorResponse, jsonResponse } from '@/lib/api'
import { getIncidents } from '@/lib/storage'
import { isValidMonitorId } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/incidents?monitorId= — newest first. */
export async function GET(request: Request) {
  const monitorId = new URL(request.url).searchParams.get('monitorId') ?? undefined

  if (monitorId && !isValidMonitorId(monitorId)) {
    return jsonResponse({ error: 'Invalid monitorId' }, { status: 400 })
  }

  try {
    const { incidents } = await getIncidents()
    const selected = incidents
      .filter((incident) => !monitorId || incident.monitorId === monitorId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return jsonResponse({ incidents: selected })
  } catch (error) {
    return errorResponse(error)
  }
}
