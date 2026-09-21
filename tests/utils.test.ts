import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatDuration,
  formatFullTimestamp,
  formatResponseTime,
  formatUptime,
  hostnameOf,
  slugify,
} from '../lib/utils'

/** These render the text of every alert, so a regression here is user-visible. */

test('a duration reads the way a person would say it', () => {
  assert.equal(formatDuration(0), '0 seconds')
  assert.equal(formatDuration(1000), '1 second')
  assert.equal(formatDuration(45_000), '45 seconds')
  assert.equal(formatDuration(6 * 60_000), '6 minutes')
  assert.equal(formatDuration(3600_000), '1 hour')
  assert.equal(formatDuration(3600_000 + 1800_000), '1 hour 30 minutes')
  assert.equal(formatDuration(25 * 3600_000), '1 day 1 hour')
  assert.equal(formatDuration(48 * 3600_000), '2 days')
  assert.equal(formatDuration(null), '—')
})

test('a response time is rounded the way it is read', () => {
  assert.equal(formatResponseTime(184), '184 ms')
  assert.equal(formatResponseTime(2412), '2.41 s')
  assert.equal(formatResponseTime(null), '—')
})

test('uptime keeps two decimals', () => {
  assert.equal(formatUptime(99.9134), '99.91%')
  assert.equal(formatUptime(100), '100.00%')
  assert.equal(formatUptime(null), '—')
})

test('a host is shown without its scheme or path', () => {
  assert.equal(hostnameOf('https://sharyn.kz/login?next=/'), 'sharyn.kz')
  assert.equal(hostnameOf('not a url'), 'not a url')
})

test('an alert timestamp always carries its zone', () => {
  const iso = '2026-09-21T07:04:00.000Z'
  const almaty = formatFullTimestamp(iso, 'Asia/Almaty')
  assert.match(almaty, /21 Sept 2026, 12:04 GMT\+5/)

  // An unknown zone falls back to UTC rather than to the runner's local time.
  assert.match(formatFullTimestamp(iso, 'Mars/Olympus'), /07:04 UTC/)

  // A timestamp that cannot be parsed is shown as it came, not as "Invalid Date".
  assert.equal(formatFullTimestamp('nonsense', 'UTC'), 'nonsense')
})

test('a slug is safe to use as an id', () => {
  assert.equal(slugify('Шарын VMS'), 'vms')
  assert.equal(slugify('Daryn AST  Portal!'), 'daryn-ast-portal')
  assert.equal(slugify('---trim---'), 'trim')
})
