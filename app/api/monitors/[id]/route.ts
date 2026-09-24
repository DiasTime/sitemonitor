import { errorResponse, jsonResponse } from '@/lib/api'
import { removeMonitor, setMonitorEnabled, updateMonitor, type AddMonitorInput } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** DELETE /api/monitors/:id — stop monitoring a site. */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params
  try {
    const result = await removeMonitor(id)
    if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status })
    return jsonResponse({ monitor: result.monitor })
  } catch (error) {
    return errorResponse(error)
  }
}

/** PATCH /api/monitors/:id — pause or resume a site without losing its history. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params

  let body: { enabled?: unknown }
  try {
    body = (await request.json()) as { enabled?: unknown }
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body?.enabled !== 'boolean') {
    return jsonResponse({ error: '"enabled" must be a boolean' }, { status: 400 })
  }

  try {
    const result = await setMonitorEnabled(id, body.enabled)
    if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status })
    return jsonResponse({ monitor: result.monitor })
  } catch (error) {
    return errorResponse(error)
  }
}

/** PUT /api/monitors/:id — change a site's URL, name, type or login settings. */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params

  let body: Partial<Record<keyof AddMonitorInput, unknown>>
  try {
    body = (await request.json()) as Partial<Record<keyof AddMonitorInput, unknown>>
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const result = await updateMonitor(id, {
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
    if (!result.ok) return jsonResponse({ error: result.error }, { status: result.status })
    return jsonResponse({ monitor: result.monitor })
  } catch (error) {
    return errorResponse(error)
  }
}
