import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countFromEnv, numberFromEnv } from '../lib/env'

/**
 * These exist because of a real outage of features rather than of sites:
 * `FOO: ${{ vars.FOO }}` for an undefined repository variable sets FOO to the
 * empty string, `Number('')` is 0, and two settings where 0 means "off"
 * therefore shipped off.
 */

test('an undefined repository variable does not mean zero', () => {
  // This is exactly what GitHub Actions passes for `${{ vars.UNSET }}`.
  assert.equal(countFromEnv('CONFIRM_RETRIES', 2, { CONFIRM_RETRIES: '' }), 2)
  assert.equal(countFromEnv('REMINDER_INTERVAL_MINUTES', 360, { REMINDER_INTERVAL_MINUTES: '' }), 360)
  assert.equal(numberFromEnv('CHECK_TIMEOUT_MS', 10_000, { CHECK_TIMEOUT_MS: '' }), 10_000)
})

test('whitespace is still nothing', () => {
  assert.equal(countFromEnv('X', 2, { X: '   ' }), 2)
  assert.equal(numberFromEnv('X', 9, { X: '\t' }), 9)
})

test('a variable that is simply absent falls back too', () => {
  assert.equal(countFromEnv('X', 2, {}), 2)
  assert.equal(numberFromEnv('X', 9, {}), 9)
})

test('an explicit zero is honoured where zero is a setting', () => {
  assert.equal(countFromEnv('X', 2, { X: '0' }), 0)
  // ...and rejected where it would mean "no timeout at all".
  assert.equal(numberFromEnv('X', 9, { X: '0' }), 9)
})

test('ordinary values are read', () => {
  assert.equal(countFromEnv('X', 2, { X: '5' }), 5)
  assert.equal(countFromEnv('X', 2, { X: ' 5 ' }), 5)
  assert.equal(countFromEnv('X', 2, { X: '2.7' }), 2, 'a count is whole')
  assert.equal(numberFromEnv('X', 9, { X: '2.5' }), 2.5)
})

test('nonsense falls back rather than becoming NaN', () => {
  assert.equal(countFromEnv('X', 2, { X: 'soon' }), 2)
  assert.equal(countFromEnv('X', 2, { X: '-1' }), 2)
  assert.equal(numberFromEnv('X', 9, { X: 'later' }), 9)
  assert.equal(numberFromEnv('X', 9, { X: '-3' }), 9)
})
