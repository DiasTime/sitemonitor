import 'server-only'

import { NextResponse } from 'next/server'

import { GitHubApiError, GitHubConfigError } from '@/lib/github'

/**
 * Turn an exception from the storage layer into a response the dashboard can
 * render. Configuration problems are the common case on a fresh deployment, so
 * they get an explicit message instead of a generic 500.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof GitHubConfigError) {
    return NextResponse.json(
      {
        error: error.message,
        hint: 'Set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO in your Vercel project settings.',
      },
      { status: 500 },
    )
  }

  if (error instanceof GitHubApiError) {
    const status = error.status === 404 ? 404 : error.status >= 500 ? 502 : error.status
    return NextResponse.json({ error: error.message }, { status })
  }

  console.error('Unexpected API error:', error)
  return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
}

/** JSON response that is never cached by Vercel's edge or the browser. */
export function jsonResponse(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init)
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  return response
}
