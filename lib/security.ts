/**
 * URL validation and SSRF protection.
 *
 * The monitoring script performs HTTP requests against URLs supplied through the
 * dashboard, so every URL is validated twice:
 *
 *  1. at write time (`validateMonitorUrl`) — scheme, length, shape and literal
 *     private addresses are rejected before the monitor is stored;
 *  2. at request time (`scripts/monitor.ts`) — the hostname is resolved and every
 *     resolved IP is checked with `isBlockedAddress`, and the socket is pinned to
 *     that vetted address so DNS rebinding cannot redirect the request.
 *
 * This module is dependency-free on purpose: it runs in the Next.js server
 * runtime and in the plain Node monitoring script alike.
 */

export const MAX_URL_LENGTH = 2048
export const MAX_NAME_LENGTH = 80

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** Hostnames that always resolve to something internal. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

/** Suffixes reserved for internal / link-local name resolution. */
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.home',
  '.home.arpa',
  '.lan',
]

/** Whitespace and C0/C1 control characters, rejected wherever they appear. */
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/

export interface UrlValidationResult {
  ok: boolean
  /** Normalised URL, only present when `ok` is true. */
  url?: string
  error?: string
}

function parseIPv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    // Reject zero-padded octets such as 010.0.0.1 — some resolvers read them as octal.
    if (part.length > 1 && part[0] === '0') return null
    octets.push(n)
  }
  return octets
}

/** True for any IPv4 address that is not globally routable. */
function isBlockedIPv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 0) return true // IETF protocol assignments + TEST-NET-1
  if (a === 192 && b === 88) return true // 6to4 relay anycast
  if (a === 192 && b === 168) return true // private
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

/** Expand an IPv6 literal to its 8 groups, or null when malformed. */
function parseIPv6(value: string): number[] | null {
  let input = value.trim()
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1)
  // Drop a zone index (fe80::1%eth0).
  const zone = input.indexOf('%')
  if (zone !== -1) input = input.slice(0, zone)
  if (!input.includes(':')) return null

  // A trailing IPv4 form (::ffff:127.0.0.1) becomes two 16-bit groups.
  let tail: number[] = []
  const lastColon = input.lastIndexOf(':')
  const lastPart = input.slice(lastColon + 1)
  if (lastPart.includes('.')) {
    const v4 = parseIPv4(lastPart)
    if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    input = input.slice(0, lastColon + 1) + '0:0'
  }

  const halves = input.split('::')
  if (halves.length > 2) return null

  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return null
      groups.push(parseInt(chunk, 16))
    }
    return groups
  }

  const head = toGroups(halves[0])
  if (!head) return null

  let groups: number[]
  if (halves.length === 2) {
    const rest = toGroups(halves[1])
    if (!rest) return null
    const fill = 8 - head.length - rest.length
    if (fill < 0) return null
    groups = [...head, ...new Array(fill).fill(0), ...rest]
  } else {
    groups = head
  }

  if (groups.length !== 8) return null

  if (tail.length) {
    // The placeholder groups appended above are replaced by the real IPv4 pair.
    groups = [...groups.slice(0, 6), ...tail]
  }

  return groups
}

function embeddedIPv4(groups: number[], offset: number): number[] {
  return [
    groups[offset] >> 8,
    groups[offset] & 0xff,
    groups[offset + 1] >> 8,
    groups[offset + 1] & 0xff,
  ]
}

function isBlockedIPv6(groups: number[]): boolean {
  const [g0, g1] = groups
  if (groups.every((g) => g === 0)) return true // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1

  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d.
  const firstFiveZero = groups.slice(0, 5).every((g) => g === 0)
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    return isBlockedIPv4(embeddedIPv4(groups, 6))
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (g0 === 0x0064 && g1 === 0xff9b) {
    return isBlockedIPv4(embeddedIPv4(groups, 6))
  }
  // 6to4 2002::/16 wraps an IPv4 address in the next two groups.
  if (g0 === 0x2002) {
    return isBlockedIPv4(embeddedIPv4(groups, 1))
  }
  if ((g0 & 0xfe00) === 0xfc00) return true // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true // multicast ff00::/8
  if (g0 === 0x0100 && g1 === 0x0000) return true // discard-only 100::/64
  if (g0 === 0x2001 && g1 === 0x0db8) return true // documentation
  return false
}

/**
 * True when the literal address (IPv4 or IPv6) points somewhere private,
 * loopback, link-local or otherwise not publicly routable. Non-literals return
 * false — hostname rules are handled by `isBlockedHostname`.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIPv4(address)
  if (v4) return isBlockedIPv4(v4)
  const v6 = parseIPv6(address)
  if (v6) return isBlockedIPv6(v6)
  return false
}

/** True when the hostname is an IP literal in any notation we accept. */
export function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null
}

/** True when a hostname is reserved for internal name resolution. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (isIpLiteral(host)) return isBlockedAddress(host)
  if (BLOCKED_HOSTNAMES.has(host)) return true
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true
  // A bare, dot-less name can only resolve through a local search domain.
  if (!host.includes('.')) return true
  return false
}

/**
 * Validate a URL supplied by the dashboard before it is stored as a monitor.
 * Returns the normalised URL on success, or a human-readable error.
 */
export function validateMonitorUrl(raw: unknown): UrlValidationResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'URL must be a string' }
  }

  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'URL is required' }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: `URL must be at most ${MAX_URL_LENGTH} characters` }
  }
  if (UNSAFE_CHARS.test(trimmed)) {
    return { ok: false, error: 'URL contains invalid characters' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'URL is not valid. Include the scheme, e.g. https://example.com' }
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: 'Only http:// and https:// URLs are allowed' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs with embedded credentials are not allowed' }
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!hostname) return { ok: false, error: 'URL must include a hostname' }
  if (isBlockedHostname(hostname)) {
    return {
      ok: false,
      error: 'Private, internal and loopback addresses are not allowed',
    }
  }

  if (parsed.port) {
    const port = Number(parsed.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: 'URL port is not valid' }
    }
  }

  parsed.hash = ''
  const normalised = parsed.toString()
  if (normalised.length > MAX_URL_LENGTH) {
    return { ok: false, error: `URL must be at most ${MAX_URL_LENGTH} characters` }
  }

  return { ok: true, url: normalised }
}

/** Validate a display name for a monitor. */
export function validateMonitorName(raw: unknown): { ok: boolean; name?: string; error?: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Name must be a string' }
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, error: 'Name is required' }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters` }
  }
  if (UNSAFE_CHARS.test(name.replace(/ /g, ''))) {
    return { ok: false, error: 'Name contains invalid characters' }
  }
  return { ok: true, name }
}

/** Monitor ids end up in URLs and JSON keys, so keep them strictly bounded. */
export function isValidMonitorId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}
