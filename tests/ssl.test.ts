import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeSslDaysLeft,
  isNoticeFor,
  sslDaysLeft,
  sslNoticeDue,
  sslStage,
  validateSslDate,
} from '../lib/ssl'

// 24 Sep 2026, 12:00 UTC — 17:00 in Almaty.
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0)

test('days left counts calendar days, 0 on the day itself', () => {
  assert.equal(sslDaysLeft('2026-09-29', NOW, 'UTC'), 5)
  assert.equal(sslDaysLeft('2026-09-24', NOW, 'UTC'), 0)
  assert.equal(sslDaysLeft('2026-09-21', NOW, 'UTC'), -3)
})

test('days left follows the given time zone across midnight', () => {
  // 21:00 UTC is already the 25th in Almaty (UTC+5).
  const lateUtc = Date.UTC(2026, 8, 24, 21, 0, 0)
  assert.equal(sslDaysLeft('2026-09-29', lateUtc, 'UTC'), 5)
  assert.equal(sslDaysLeft('2026-09-29', lateUtc, 'Asia/Almaty'), 4)
})

test('an unknown time zone falls back to UTC instead of throwing', () => {
  assert.equal(sslDaysLeft('2026-09-29', NOW, 'Not/AZone'), 5)
})

test('unreadable dates give no answer', () => {
  assert.equal(sslDaysLeft('2026-02-31', NOW), null)
  assert.equal(sslDaysLeft('tomorrow', NOW), null)
})

test('stages: fine, then soon inside the window, then expired from the day on', () => {
  assert.equal(sslStage(6, 5), null)
  assert.equal(sslStage(5, 5), 'soon')
  assert.equal(sslStage(1, 5), 'soon')
  assert.equal(sslStage(0, 5), 'expired')
  assert.equal(sslStage(-10, 5), 'expired')
})

test('the warning goes out once when the window opens', () => {
  const opts = { timeZone: 'UTC', warningDays: 5 }
  assert.equal(sslNoticeDue('2026-09-30', undefined, NOW, opts), null, '6 days: too early')

  const first = sslNoticeDue('2026-09-29', undefined, NOW, opts)
  assert.deepEqual(first, { stage: 'soon', daysLeft: 5, key: '2026-09-29:soon' })
  assert.equal(sslNoticeDue('2026-09-29', first!.key, NOW, opts), null, 'not again next run')
})

test('a second notice goes out on the expiry day', () => {
  const onTheDay = Date.UTC(2026, 8, 29, 8, 0, 0)
  const notice = sslNoticeDue('2026-09-29', '2026-09-29:soon', onTheDay, { timeZone: 'UTC' })
  assert.equal(notice?.stage, 'expired')
  assert.equal(notice?.key, '2026-09-29:expired')
  assert.equal(sslNoticeDue('2026-09-29', notice!.key, onTheDay + 3600_000, { timeZone: 'UTC' }), null)
})

test('a new date after a renewal starts over', () => {
  assert.equal(sslNoticeDue('2027-09-29', '2026-09-29:expired', NOW, { timeZone: 'UTC' }), null)
  assert.equal(isNoticeFor('2027-09-29', '2026-09-29:expired'), false)
  assert.equal(isNoticeFor('2026-09-29', '2026-09-29:soon'), true)
})

test('a date entered already inside the window is announced straight away', () => {
  assert.equal(sslNoticeDue('2026-09-26', undefined, NOW, { timeZone: 'UTC' })?.stage, 'soon')
  assert.equal(sslNoticeDue('2026-09-01', undefined, NOW, { timeZone: 'UTC' })?.stage, 'expired')
})

test('form validation accepts blank and real dates only', () => {
  assert.deepEqual(validateSslDate(''), { ok: true, date: undefined })
  assert.deepEqual(validateSslDate(undefined), { ok: true, date: undefined })
  assert.deepEqual(validateSslDate('2026-10-01'), { ok: true, date: '2026-10-01' })
  assert.equal(validateSslDate('2026-13-01').ok, false)
  assert.equal(validateSslDate('01.10.2026').ok, false)
  assert.equal(validateSslDate('1026-10-01').ok, false)
  assert.equal(validateSslDate(20261001).ok, false)
})

test('dashboard wording', () => {
  assert.equal(describeSslDaysLeft(12), 'SSL in 12 days')
  assert.equal(describeSslDaysLeft(1), 'SSL expires tomorrow')
  assert.equal(describeSslDaysLeft(0), 'SSL expires today')
  assert.equal(describeSslDaysLeft(-1), 'SSL expired 1 day ago')
  assert.equal(describeSslDaysLeft(-4), 'SSL expired 4 days ago')
})
