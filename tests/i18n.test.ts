import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveLocale } from '../lib/i18n/config'
import { createFormatters } from '../lib/i18n/format'
import { ru } from '../lib/i18n/messages/ru'

test('a saved choice wins over the browser', () => {
  assert.equal(resolveLocale('en', 'ru-RU,ru;q=0.9'), 'en')
  assert.equal(resolveLocale('ru', 'en-US'), 'ru')
})

test('without a saved choice, Accept-Language decides', () => {
  assert.equal(resolveLocale(undefined, 'ru-RU,ru;q=0.9,en;q=0.8'), 'ru')
  assert.equal(resolveLocale(undefined, 'en-US,en;q=0.9,ru;q=0.8'), 'en')
  assert.equal(resolveLocale(undefined, 'de-DE,ru;q=0.5'), 'ru')
  assert.equal(resolveLocale(undefined, 'kk-KZ'), 'ru')
  assert.equal(resolveLocale(undefined, 'fr-FR'), 'en')
  assert.equal(resolveLocale(undefined, null), 'en')
})

test('an unknown cookie value is ignored', () => {
  assert.equal(resolveLocale('de', 'ru'), 'ru')
})

test('Russian copy agrees with its numbers', () => {
  assert.equal(ru.dashboard.down(1, 1), 'Недоступно 1 из 1 монитора')
  assert.equal(ru.dashboard.down(2, 9), 'Недоступно 2 из 9 мониторов')
  assert.equal(ru.ssl.inDays(3), 'SSL через 3 дня')
  assert.equal(ru.ssl.inDays(21), 'SSL через 21 день')
  assert.equal(ru.chart.failed(5), 'Неудачных: 5 проверок')
})

test('Russian formatters use Russian units and decimal commas', () => {
  const format = createFormatters('ru')
  assert.equal(format.responseTime(2412), '2,41 с')
  assert.equal(format.uptime(99.9134), '99,91%')
  assert.equal(format.relative(new Date(Date.now() - 3 * 60_000).toISOString()), '3 минуты назад')
})

test('English formatters are unchanged', () => {
  const format = createFormatters('en')
  assert.equal(format.responseTime(2412), '2.41 s')
  assert.equal(format.relative(new Date(Date.now() - 3 * 60_000).toISOString()), '3 minutes ago')
})
