import 'server-only'

/**
 * Minimal GitHub Contents API client.
 *
 * The repository itself is the database: `data/*.json` is read here for the
 * dashboard and written here when a monitor is added or removed. Reads are
 * cached in memory so that dashboard polling does not translate into one GitHub
 * API request per visitor, and writes retry on SHA conflicts (409/422) caused by
 * a monitoring run committing at the same moment.
 */

const API_ROOT = 'https://api.github.com'

export interface GitHubConfig {
  token: string
  owner: string
  repo: string
  branch: string
}

export class GitHubConfigError extends Error {}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function getGitHubConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  const branch = process.env.GITHUB_BRANCH || 'main'

  const missing = [
    !token && 'GITHUB_TOKEN',
    !owner && 'GITHUB_OWNER',
    !repo && 'GITHUB_REPO',
  ].filter(Boolean)

  if (missing.length) {
    throw new GitHubConfigError(
      `Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    )
  }

  return { token: token!, owner: owner!, repo: repo!, branch }
}

function headers(config: GitHubConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'site-monitor',
  }
}

interface ContentsResponse {
  content?: string
  encoding?: string
  sha: string
}

export interface FileRead<T> {
  data: T
  sha: string | null
}

interface CacheEntry {
  value: FileRead<unknown>
  expiresAt: number
}

/**
 * Module-level cache. Serverless instances are short-lived, so this is a best
 * effort buffer that collapses bursts of dashboard polling into one API call.
 */
const cache = new Map<string, CacheEntry>()

function cacheTtlMs(): number {
  const seconds = Number(process.env.DATA_CACHE_TTL_SECONDS)
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 20) * 1000
}

export function invalidateCache(path?: string) {
  if (path) cache.delete(path)
  else cache.clear()
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * Read and parse a JSON file from the repository.
 * Returns `fallback` when the file does not exist yet (first run).
 */
export async function readJsonFile<T>(
  path: string,
  fallback: T,
  options: { cache?: boolean } = {},
): Promise<FileRead<T>> {
  const useCache = options.cache !== false
  const ttl = cacheTtlMs()

  if (useCache && ttl > 0) {
    const hit = cache.get(path)
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as FileRead<T>
    }
  }

  const config = getGitHubConfig()
  const url = `${API_ROOT}/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(config.branch)}`

  let response: Response
  try {
    response = await fetch(url, { headers: headers(config), cache: 'no-store' })
  } catch (error) {
    const stale = cache.get(path)
    if (stale) return stale.value as FileRead<T>
    throw new GitHubApiError(
      `Could not reach the GitHub API: ${(error as Error).message}`,
      502,
    )
  }

  if (response.status === 404) {
    const value: FileRead<T> = { data: fallback, sha: null }
    if (useCache && ttl > 0) cache.set(path, { value, expiresAt: Date.now() + ttl })
    return value
  }

  if (!response.ok) {
    const stale = cache.get(path)
    if (stale) return stale.value as FileRead<T>
    throw new GitHubApiError(
      `GitHub API returned ${response.status} for ${path}: ${await safeText(response)}`,
      response.status,
    )
  }

  const body = (await response.json()) as ContentsResponse
  let text: string
  if (body.content && body.encoding === 'base64') {
    text = Buffer.from(body.content, 'base64').toString('utf8')
  } else {
    // Files larger than 1 MB come back without inline content.
    text = await readBlob(config, body.sha)
  }

  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    throw new GitHubApiError(`${path} in the repository is not valid JSON`, 500)
  }

  const value: FileRead<T> = { data, sha: body.sha }
  if (useCache && ttl > 0) cache.set(path, { value, expiresAt: Date.now() + ttl })
  return value
}

async function readBlob(config: GitHubConfig, sha: string): Promise<string> {
  const response = await fetch(
    `${API_ROOT}/repos/${config.owner}/${config.repo}/git/blobs/${sha}`,
    { headers: headers(config), cache: 'no-store' },
  )
  if (!response.ok) {
    throw new GitHubApiError(
      `GitHub API returned ${response.status} while reading blob ${sha}`,
      response.status,
    )
  }
  const body = (await response.json()) as { content: string; encoding: string }
  return Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return '<no body>'
  }
}

/**
 * Read-modify-write a JSON file with optimistic concurrency.
 *
 * `update` receives the current contents and returns the next value, or `null`
 * to abort the write. On a 409/422 SHA conflict — another writer (usually a
 * monitoring run) committed in between — the file is re-read and `update` is
 * applied again to the fresh contents.
 */
export async function updateJsonFile<T>(
  path: string,
  fallback: T,
  update: (current: T) => T | null,
  message: string,
  options: { maxAttempts?: number } = {},
): Promise<{ written: boolean; data: T }> {
  const config = getGitHubConfig()
  const maxAttempts = options.maxAttempts ?? 4

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Always read fresh: a stale cached SHA guarantees a conflict.
    const { data: current, sha } = await readJsonFile<T>(path, fallback, { cache: false })
    const next = update(current)
    if (next === null) return { written: false, data: current }

    const body: Record<string, string> = {
      message,
      content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8').toString('base64'),
      branch: config.branch,
    }
    if (sha) body.sha = sha

    const response = await fetch(
      `${API_ROOT}/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`,
      {
        method: 'PUT',
        headers: { ...headers(config), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    )

    if (response.ok) {
      invalidateCache(path)
      return { written: true, data: next }
    }

    const isConflict = response.status === 409 || response.status === 422
    if (isConflict && attempt < maxAttempts) {
      invalidateCache(path)
      // Small randomised backoff so concurrent writers do not collide again.
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt + Math.random() * 150))
      continue
    }

    throw new GitHubApiError(
      `GitHub API returned ${response.status} while writing ${path}: ${await safeText(response)}`,
      response.status,
    )
  }

  throw new GitHubApiError(
    `Could not write ${path}: the file kept changing under us. Please retry.`,
    409,
  )
}

/**
 * Fire a `repository_dispatch` event, which the monitoring workflow listens for.
 *
 * Deliberately not `workflow_dispatch`: that endpoint needs an "Actions: write"
 * token, while this one is covered by the "Contents: write" the dashboard
 * already requires for editing data/monitors.json. One less permission to grant.
 */
export async function dispatchRepositoryEvent(
  eventType: string,
  clientPayload: Record<string, unknown> = {},
): Promise<void> {
  const config = getGitHubConfig()

  const response = await fetch(
    `${API_ROOT}/repos/${config.owner}/${config.repo}/dispatches`,
    {
      method: 'POST',
      headers: { ...headers(config), 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
      cache: 'no-store',
    },
  )

  if (response.status === 204) return

  const detail = await safeText(response)
  if (response.status === 403 || response.status === 404) {
    throw new GitHubApiError(
      'GitHub refused to start the workflow. The token needs "Contents: read and write" ' +
        `on this repository. (${response.status}: ${detail})`,
      response.status,
    )
  }
  throw new GitHubApiError(
    `GitHub API returned ${response.status} while starting the workflow: ${detail}`,
    response.status,
  )
}
