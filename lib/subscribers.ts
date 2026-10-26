/**
 * data/subscribers.json, sealed.
 *
 * Every other data file is fit to publish — sites, statuses, outage windows —
 * but this one is a list of people: Telegram chat ids and usernames. Committed
 * as plain JSON it would be readable by anyone the moment the repository went
 * public, and from then on in every commit of its history. So when
 * SUBSCRIBERS_KEY is set, the list is stored encrypted (AES-256-GCM) and only
 * the run and the dashboard, which both hold the key, can read it.
 *
 * Without the key the file stays plain JSON, exactly as before, which is fine
 * for a private repository. A plain file is sealed on the first write after a
 * key is configured.
 *
 * No npm imports: the monitoring run loads this from a bare checkout.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import type { SubscribersFile } from './types'

export const EMPTY_SUBSCRIBERS: SubscribersFile = { offset: 0, subscribers: [] }

const ALGORITHM = 'aes-256-gcm'
/** Binds the ciphertext to its purpose, so it cannot be passed off as something else. */
const CONTEXT = Buffer.from('site-monitor/subscribers/v1', 'utf8')

export interface SealedSubscribers {
  /** Shown to whoever opens the file on GitHub. */
  note: string
  sealed: typeof ALGORITHM
  iv: string
  tag: string
  data: string
}

/** What data/subscribers.json holds: the list itself, or the list sealed. */
export type StoredSubscribers = SubscribersFile | SealedSubscribers

/** The file is sealed and this process cannot open it: no key, or a different one. */
export class SubscribersLockedError extends Error {
  constructor(reason: string) {
    super(`data/subscribers.json is encrypted and ${reason}`)
    this.name = 'SubscribersLockedError'
  }
}

/**
 * The key, from SUBSCRIBERS_KEY. Any string works — it is hashed to 256 bits —
 * but it should be random: `openssl rand -base64 32`. Blank means unset.
 */
export function subscribersKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = env.SUBSCRIBERS_KEY?.trim()
  return secret ? createHash('sha256').update(secret, 'utf8').digest() : null
}

export function isSealed(stored: unknown): stored is SealedSubscribers {
  return Boolean(stored) && typeof stored === 'object' && (stored as SealedSubscribers).sealed === ALGORITHM
}

/** A hand-edited or half-written file must not throw where it is read. */
export function normaliseSubscribers(file: Partial<SubscribersFile> | null | undefined): SubscribersFile {
  return {
    offset: typeof file?.offset === 'number' ? file.offset : 0,
    subscribers: Array.isArray(file?.subscribers) ? file.subscribers : [],
  }
}

/** Read the stored file, decrypting it if it is sealed. Throws SubscribersLockedError if it cannot be. */
export function openSubscribers(stored: unknown, key: Buffer | null): SubscribersFile {
  if (!isSealed(stored)) return normaliseSubscribers(stored as Partial<SubscribersFile> | null)
  if (!key) throw new SubscribersLockedError('SUBSCRIBERS_KEY is not set')

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, 'base64'))
    decipher.setAAD(CONTEXT)
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
    const plain = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()])
    return normaliseSubscribers(JSON.parse(plain.toString('utf8')) as Partial<SubscribersFile>)
  } catch {
    throw new SubscribersLockedError('SUBSCRIBERS_KEY does not open it')
  }
}

/** What to write back: sealed when there is a key, the plain list when there is not. */
export function sealSubscribers(file: SubscribersFile, key: Buffer | null): StoredSubscribers {
  if (!key) return file

  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(CONTEXT)
  const data = Buffer.concat([cipher.update(JSON.stringify(file), 'utf8'), cipher.final()])

  return {
    note: 'Telegram subscribers, encrypted with SUBSCRIBERS_KEY. See "Making the repository public" in the README.',
    sealed: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }
}
