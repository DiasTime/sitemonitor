import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isSealed,
  openSubscribers,
  sealSubscribers,
  subscribersKey,
  SubscribersLockedError,
} from '../lib/subscribers'
import type { SubscribersFile } from '../lib/types'

const FILE: SubscribersFile = {
  offset: 123456789,
  subscribers: [
    { chatId: 111222333, label: 'someone', chatType: 'private', addedAt: '2026-08-20T06:23:34.263Z' },
    { chatId: -1001234567890, label: 'On-call group', chatType: 'supergroup', addedAt: '2026-09-01T00:00:00.000Z' },
  ],
}

const KEY = subscribersKey({ SUBSCRIBERS_KEY: 'correct horse battery staple' })

test('a blank or missing SUBSCRIBERS_KEY is no key', () => {
  assert.equal(subscribersKey({}), null)
  assert.equal(subscribersKey({ SUBSCRIBERS_KEY: '' }), null)
  assert.equal(subscribersKey({ SUBSCRIBERS_KEY: '   ' }), null)
  assert.equal(KEY?.length, 32)
})

test('with a key the list round-trips, and nothing of it is readable in the stored file', () => {
  const stored = sealSubscribers(FILE, KEY)
  assert.ok(isSealed(stored))

  const text = JSON.stringify(stored)
  for (const needle of ['111222333', '1234567890', 'someone', 'On-call', '123456789']) {
    assert.ok(!text.includes(needle), `${needle} leaked into the sealed file`)
  }

  assert.deepEqual(openSubscribers(JSON.parse(text), KEY), FILE)
})

test('sealing the same list twice gives different files', () => {
  assert.notEqual(JSON.stringify(sealSubscribers(FILE, KEY)), JSON.stringify(sealSubscribers(FILE, KEY)))
})

test('without a key the file stays plain JSON, as it always was', () => {
  assert.deepEqual(sealSubscribers(FILE, null), FILE)
  assert.deepEqual(openSubscribers(FILE, null), FILE)
  // A plain file is read the same whether or not a key is configured — that is the migration path.
  assert.deepEqual(openSubscribers(FILE, KEY), FILE)
})

test('a sealed file without the key, or with another key, is locked rather than read as empty', () => {
  const stored = sealSubscribers(FILE, KEY)
  assert.throws(() => openSubscribers(stored, null), SubscribersLockedError)
  assert.throws(
    () => openSubscribers(stored, subscribersKey({ SUBSCRIBERS_KEY: 'another key' })),
    SubscribersLockedError,
  )
})

test('a tampered sealed file is refused', () => {
  const stored = sealSubscribers(FILE, KEY)
  assert.ok(isSealed(stored))
  const data = Buffer.from(stored.data, 'base64')
  data[0] ^= 1
  assert.throws(
    () => openSubscribers({ ...stored, data: data.toString('base64') }, KEY),
    SubscribersLockedError,
  )
})

test('a missing or mangled plain file reads as no subscribers', () => {
  assert.deepEqual(openSubscribers(null, null), { offset: 0, subscribers: [] })
  assert.deepEqual(openSubscribers({ subscribers: 'nope' }, KEY), { offset: 0, subscribers: [] })
  assert.deepEqual(openSubscribers({ offset: 7 }, null), { offset: 7, subscribers: [] })
})
