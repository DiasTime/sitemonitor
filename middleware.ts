import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

/**
 * Paths that must stay reachable without a session.
 *
 * `/api/heartbeat` is the outside clock that repairs a missed schedule, so it
 * is called by machines that have no session and never will: it carries its
 * own optional token instead (HEARTBEAT_TOKEN).
 */
const PUBLIC_API = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
  '/api/heartbeat',
]

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isApi = pathname.startsWith('/api')

  if (isApi && PUBLIC_API.some((path) => pathname === path)) {
    return NextResponse.next()
  }

  const authenticated = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)

  if (pathname === '/login') {
    if (authenticated) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  if (authenticated) return NextResponse.next()

  if (isApi) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  const target = `${pathname}${search}`
  if (target !== '/dashboard') loginUrl.searchParams.set('next', target)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/dashboard/:path*', '/monitor/:path*', '/login', '/api/:path*'],
}
