import assert from 'node:assert/strict'
import { test } from 'node:test'

import { confirmFailure, isTransientFailure } from '../lib/confirm'
import type { CheckResult } from '../lib/types'

function result(over: Partial<CheckResult> = {}): CheckResult {
  return {
    monitorId: 'site',
    status: 'DOWN',
    statusCode: null,
    responseTime: null,
    error: null,
    timestamp: '2026-09-21T12:00:00.000Z',
    reported: null,
    ...over,
  }
}

const timeout = result({ error: 'Connection timeout' })
const up = result({ status: 'UP', statusCode: 200, error: null })
const notFound = result({ statusCode: 404, error: 'HTTP 404' })
const rejected = result({ statusCode: 401, error: 'HTTP 401' })
const serverError = result({ statusCode: 502, error: 'HTTP 502' })

test('a failure with no response at all is worth another look', () => {
  assert.equal(isTransientFailure(timeout), true)
  assert.equal(isTransientFailure(result({ error: 'DNS error: host not found' })), true)
  assert.equal(isTransientFailure(result({ error: 'SSL error: handshake failed' })), true)
})

test('a server admitting its own trouble is worth another look', () => {
  assert.equal(isTransientFailure(serverError), true)
  assert.equal(isTransientFailure(result({ statusCode: 503, error: 'HTTP 503' })), true)
  assert.equal(isTransientFailure(result({ statusCode: 408, error: 'HTTP 408' })), true)
  assert.equal(isTransientFailure(result({ statusCode: 429, error: 'HTTP 429' })), true)
})

test('a considered answer from the far end is taken at its word', () => {
  assert.equal(isTransientFailure(notFound), false)
  assert.equal(isTransientFailure(rejected), false)
  assert.equal(isTransientFailure(result({ statusCode: 403, error: 'HTTP 403' })), false)
})

test('a sign-in the portal rejected is never repeated', () => {
  // Repeating it is how accounts get locked out.
  assert.equal(
    isTransientFailure(result({ statusCode: 200, error: 'Sign-in failed: matched "неверный"' })),
    false,
  )
  assert.equal(
    isTransientFailure(result({ statusCode: 200, error: 'Sign-in form was shown again' })),
    false,
  )
  // But a sign-in that never reached the portal is transport, not a verdict.
  assert.equal(isTransientFailure(result({ error: 'Sign-in request failed' })), true)
})

test('configuration mistakes are not retried', () => {
  assert.equal(isTransientFailure(result({ error: 'Invalid URL: scheme not allowed' })), false)
  assert.equal(isTransientFailure(result({ error: 'Blocked: internal hostname' })), false)
  assert.equal(
    isTransientFailure(result({ error: 'No credentials configured for "x" in PORTAL_CREDENTIALS' })),
    false,
  )
})

test('a healthy result is never retried', () => {
  assert.equal(isTransientFailure(up), false)
})

/** Runs the confirmation loop over a scripted sequence of answers. */
async function probeCount(sequence: CheckResult[], over: { retries?: number; confirm?: boolean } = {}) {
  let calls = 0
  const outcome = await confirmFailure(
    async () => sequence[Math.min(calls++, sequence.length - 1)],
    {
      retries: over.retries ?? 2,
      delayMs: 10_000,
      confirm: over.confirm,
      sleep: async () => {},
    },
  )
  return { calls, status: outcome.status, error: outcome.error }
}

test('a healthy site is probed once', async () => {
  assert.deepEqual(await probeCount([up]), { calls: 1, status: 'UP', error: null })
})

test('a blip that clears never becomes an outage', async () => {
  assert.deepEqual(await probeCount([timeout, up]), { calls: 2, status: 'UP', error: null })
})

test('a real outage survives every probe', async () => {
  assert.deepEqual(await probeCount([timeout]), {
    calls: 3,
    status: 'DOWN',
    error: 'Connection timeout',
  })
})

test('recovery on the last retry still counts as healthy', async () => {
  assert.deepEqual(await probeCount([timeout, timeout, up]), {
    calls: 3,
    status: 'UP',
    error: null,
  })
})

test('a definitive failure costs a single probe', async () => {
  assert.deepEqual(await probeCount([notFound]), { calls: 1, status: 'DOWN', error: 'HTTP 404' })
  assert.deepEqual(await probeCount([rejected]), { calls: 1, status: 'DOWN', error: 'HTTP 401' })
})

test('a monitor already known to be down is probed once', async () => {
  assert.deepEqual(await probeCount([timeout], { confirm: false }), {
    calls: 1,
    status: 'DOWN',
    error: 'Connection timeout',
  })
})

test('retries can be switched off entirely', async () => {
  assert.deepEqual(await probeCount([timeout], { retries: 0 }), {
    calls: 1,
    status: 'DOWN',
    error: 'Connection timeout',
  })
})

test('the freshest description of the failure is the one reported', async () => {
  assert.deepEqual(await probeCount([timeout, serverError, serverError]), {
    calls: 3,
    status: 'DOWN',
    error: 'HTTP 502',
  })
})

test('a retry that turns definitive stops the loop early', async () => {
  assert.deepEqual(await probeCount([timeout, notFound]), {
    calls: 2,
    status: 'DOWN',
    error: 'HTTP 404',
  })
})

test('the caller is told which probes happened', async () => {
  const retried: number[] = []
  let disagreed = 0
  let calls = 0

  await confirmFailure(async () => (calls++ === 0 ? timeout : up), {
    retries: 2,
    delayMs: 1,
    sleep: async () => {},
    onRetry: (attempt) => retried.push(attempt),
    onDisagree: () => {
      disagreed += 1
    },
  })

  assert.deepEqual(retried, [1])
  assert.equal(disagreed, 1)
})
