import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatChecksRu,
  formatDaysLeftRu,
  formatDurationRu,
  formatResponseTimeRu,
  formatUptimeRu,
  plural,
} from '../lib/ru'

/**
 * Every alert counts something, and Russian agrees the noun with the number.
 * "5 часа" in a monitoring message reads as broken software, so the rule gets
 * its own tests rather than a hopeful glance.
 */

test('the noun agrees with the number', () => {
  const forms: [string, string, string] = ['час', 'часа', 'часов']
  const say = (n: number) => `${n} ${plural(n, forms)}`

  assert.equal(say(1), '1 час')
  assert.equal(say(2), '2 часа')
  assert.equal(say(4), '4 часа')
  assert.equal(say(5), '5 часов')
  assert.equal(say(0), '0 часов')
  // The teens are the exception that catches naive implementations.
  assert.equal(say(11), '11 часов')
  assert.equal(say(12), '12 часов')
  assert.equal(say(14), '14 часов')
  assert.equal(say(21), '21 час')
  assert.equal(say(22), '22 часа')
  assert.equal(say(25), '25 часов')
  assert.equal(say(101), '101 час')
  assert.equal(say(111), '111 часов')
})

test('a duration reads the way a person would say it', () => {
  assert.equal(formatDurationRu(0), '0 секунд')
  assert.equal(formatDurationRu(1000), '1 секунда')
  assert.equal(formatDurationRu(3000), '3 секунды')
  assert.equal(formatDurationRu(45_000), '45 секунд')
  assert.equal(formatDurationRu(60_000), '1 минута')
  assert.equal(formatDurationRu(6 * 60_000), '6 минут')
  assert.equal(formatDurationRu(3600_000), '1 час')
  assert.equal(formatDurationRu(2 * 3600_000), '2 часа')
  assert.equal(formatDurationRu(3600_000 + 1800_000), '1 час 30 минут')
  assert.equal(formatDurationRu(4 * 3600_000 + 2 * 60_000), '4 часа 2 минуты')
  assert.equal(formatDurationRu(25 * 3600_000), '1 день 1 час')
  assert.equal(formatDurationRu(48 * 3600_000), '2 дня')
  assert.equal(formatDurationRu(72 * 3600_000), '3 дня')
  assert.equal(formatDurationRu(5 * 24 * 3600_000), '5 дней')
  assert.equal(formatDurationRu(null), '—')
})

test('failed checks are counted in Russian too', () => {
  assert.equal(formatChecksRu(1), '1 проверка')
  assert.equal(formatChecksRu(3), '3 проверки')
  assert.equal(formatChecksRu(9), '9 проверок')
  assert.equal(formatChecksRu(11), '11 проверок')
})

test('numbers use a comma, as they do in Russian', () => {
  assert.equal(formatResponseTimeRu(184), '184 мс')
  assert.equal(formatResponseTimeRu(2412), '2,41 с')
  assert.equal(formatResponseTimeRu(null), '—')
  assert.equal(formatUptimeRu(99.9134), '99,91%')
  assert.equal(formatUptimeRu(100), '100,00%')
  assert.equal(formatUptimeRu(null), '—')
})

test('days until a date read the way they are said', () => {
  assert.equal(formatDaysLeftRu(5), 'через 5 дней')
  assert.equal(formatDaysLeftRu(1), 'через 1 день')
  assert.equal(formatDaysLeftRu(0), 'сегодня')
  assert.equal(formatDaysLeftRu(-3), '3 дня назад')
})
