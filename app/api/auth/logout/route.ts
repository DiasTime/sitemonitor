import { NextResponse } from 'next/server'

import { sessionCookieOptions } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  const { name, ...options } = sessionCookieOptions(0)
  response.cookies.set(name, '', options)
  return response
}
