import { NextResponse } from 'next/server'

import { AuthConfigError, createSessionToken, sessionCookieOptions, verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Very small in-memory throttle. Enough to blunt online guessing on one instance. */
const attempts = new Map<string, { count: number; resetAt: number }>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10

function rateLimited(key: string): boolean {
  const now = Date.now()
  const record = attempts.get(key)
  if (!record || record.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  record.count += 1
  return record.count > MAX_ATTEMPTS
}

export async function POST(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') ?? ''
  const key = forwarded.split(',')[0].trim() || 'unknown'

  if (rateLimited(key)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429 },
    )
  }

  let password: unknown
  try {
    const body = (await request.json()) as { password?: unknown }
    password = body?.password
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  let valid: boolean
  try {
    valid = await verifyPassword(password)
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return NextResponse.json(
        { error: 'ADMIN_PASSWORD is not configured on the server.' },
        { status: 500 },
      )
    }
    throw error
  }

  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
  }

  attempts.delete(key)

  const response = NextResponse.json({ ok: true })
  const { name, ...options } = sessionCookieOptions()
  response.cookies.set(name, await createSessionToken(), options)
  return response
}
