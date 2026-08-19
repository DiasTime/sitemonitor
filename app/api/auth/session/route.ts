import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Lets the login page tell "not signed in" apart from "server misconfigured". */
export async function GET() {
  const store = await cookies()
  const authenticated = await verifySessionToken(store.get(SESSION_COOKIE)?.value)
  return NextResponse.json({
    authenticated,
    configured: Boolean(process.env.ADMIN_PASSWORD),
  })
}
