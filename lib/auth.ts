/**
 * Single-owner authentication.
 *
 * There are no user accounts: the dashboard is unlocked with `ADMIN_PASSWORD`,
 * and the browser then carries a signed, HTTP-only session cookie. The cookie
 * holds only an expiry plus an HMAC over it — nothing secret and nothing the
 * client can forge without the server key.
 *
 * Implemented with Web Crypto (not `node:crypto`) so the same helpers run in
 * middleware on the edge runtime and in route handlers on Node.
 */

export const SESSION_COOKIE = 'sm_session'

/** Session lifetime in seconds (7 days). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7

export class AuthConfigError extends Error {}

function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    throw new AuthConfigError('ADMIN_PASSWORD is not set')
  }
  return password
}

/**
 * Key used to sign session cookies. Defaults to a value derived from
 * ADMIN_PASSWORD so a single environment variable is enough to get started;
 * set SESSION_SECRET to rotate sessions independently of the password.
 */
function getSigningSecret(): string {
  return process.env.SESSION_SECRET || `sm:${getAdminPassword()}`
}

const encoder = new TextEncoder()

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return base64url(new Uint8Array(signature))
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Length-independent, content constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/** Compare a submitted password against ADMIN_PASSWORD without leaking timing. */
export async function verifyPassword(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== 'string' || !candidate || candidate.length > 512) return false
  const secret = getAdminPassword()
  // Hashing both sides first keeps the comparison constant-time regardless of length.
  const [a, b] = await Promise.all([hmac(secret, candidate), hmac(secret, secret)])
  return timingSafeEqual(a, b)
}

/** Issue a signed session token valid for SESSION_MAX_AGE seconds. */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + SESSION_MAX_AGE
  const payload = `v1.${expiresAt}`
  const signature = await hmac(getSigningSecret(), payload)
  return `${payload}.${signature}`
}

/** Validate a session token's signature and expiry. */
export async function verifySessionToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<boolean> {
  if (!token || token.length > 512) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [version, expiresAt, signature] = parts
  if (version !== 'v1') return false

  const expiry = Number(expiresAt)
  if (!Number.isFinite(expiry) || expiry * 1000 <= now) return false

  let expected: string
  try {
    expected = await hmac(getSigningSecret(), `${version}.${expiresAt}`)
  } catch {
    return false
  }
  return timingSafeEqual(expected, signature)
}

export interface SessionCookieOptions {
  name: string
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE): SessionCookieOptions {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax',
    // Vercel serves over HTTPS; plain `next dev` over HTTP would reject a secure cookie.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}

/** True when the request carries a valid session cookie. */
export async function isAuthenticated(request: {
  cookies: { get(name: string): { value: string } | undefined }
}): Promise<boolean> {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
}
