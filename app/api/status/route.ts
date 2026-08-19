import { errorResponse, jsonResponse } from '@/lib/api'
import { getMonitors, getStatus } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/status — current state of every monitor, joined with its config.
 * This is the endpoint the dashboard polls every 30 seconds.
 */
export async function GET() {
  try {
    const [{ monitors }, status] = await Promise.all([getMonitors(), getStatus()])

    return jsonResponse({
      updatedAt: status.updatedAt || null,
      monitors: monitors.map((monitor) => ({
        ...monitor,
        state: status.monitors[monitor.id] ?? null,
      })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
