import { errorResponse, jsonResponse } from '@/lib/api'
import { addMonitor, getMonitors, MAX_MONITORS } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/monitors — the configured sites. */
export async function GET() {
  try {
    const { monitors } = await getMonitors()
    return jsonResponse({ monitors, limit: MAX_MONITORS })
  } catch (error) {
    return errorResponse(error)
  }
}

interface AddMonitorBody {
  url?: unknown
  name?: unknown
  type?: unknown
  loginUrl?: unknown
  loginBodyType?: unknown
  usernameField?: unknown
  passwordField?: unknown
  successText?: unknown
  failureText?: unknown
}

/** POST /api/monitors — add a site (writes data/monitors.json through the GitHub API). */
export async function POST(request: Request) {
  let body: AddMonitorBody
  try {
    body = (await request.json()) as AddMonitorBody
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await addMonitor({
      url: body?.url,
      name: body?.name,
      type: body?.type,
      loginUrl: body?.loginUrl,
      loginBodyType: body?.loginBodyType,
      usernameField: body?.usernameField,
      passwordField: body?.passwordField,
      successText: body?.successText,
      failureText: body?.failureText,
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, { status: result.status })
    }
    return jsonResponse({ monitor: result.monitor }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
