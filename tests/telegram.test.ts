import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  identify,
  parseCommand,
  statusMessage,
  subscribe,
  unsubscribe,
} from '../lib/telegram'
import type { Monitor, MonitorStatus, StatusFile, SubscribersFile } from '../lib/types'

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0)
const ago = (hours: number) => new Date(NOW - hours * 3600_000).toISOString()

test('a command is recognised however Telegram dressed it up', () => {
  assert.deepEqual(parseCommand('/status'), { name: 'status', argument: '' })
  assert.deepEqual(parseCommand('  /status  '), { name: 'status', argument: '' })
  // Group chats append the bot's name to every command.
  assert.deepEqual(parseCommand('/status@SiteMonitorBot'), { name: 'status', argument: '' })
  assert.deepEqual(parseCommand('/START'), { name: 'start', argument: '' })
  assert.deepEqual(parseCommand('/start@Bot my passphrase'), {
    name: 'start',
    argument: 'my passphrase',
  })
})

test('ordinary chatter is not a command', () => {
  assert.equal(parseCommand('hello'), null)
  assert.equal(parseCommand('the /status of things'), null)
  assert.equal(parseCommand(''), null)
  assert.equal(parseCommand(undefined), null)
  assert.equal(parseCommand(null), null)
})

function monitor(over: Partial<Monitor> = {}): Monitor {
  return { id: 'site', name: 'Site', url: 'https://site.kz', enabled: true, ...over }
}

function state(over: Partial<MonitorStatus> = {}): MonitorStatus {
  return {
    id: 'site',
    status: 'UP',
    statusCode: 200,
    responseTime: 1210,
    error: null,
    lastCheck: ago(0.2),
    since: ago(72),
    totalChecks: 100,
    totalUp: 100,
    uptime24h: 100,
    uptime7d: 100,
    uptime30d: 99.5,
    avgResponse24h: 1200,
    incidents: 0,
    reported: null,
    ...over,
  }
}

function board(monitors: Monitor[], states: Record<string, MonitorStatus>, over: Partial<StatusFile> = {}) {
  const status: StatusFile = {
    updatedAt: ago(0.2),
    lastCommitAt: ago(0.2),
    monitors: states,
    ...over,
  }
  return statusMessage(monitors, status, NOW, { staleAfterMs: 90 * 60_000, timeZone: 'Asia/Almaty' })
}

test('everything healthy reads as one line plus the sites', () => {
  const text = board([monitor()], { site: state() })

  assert.match(text, /^🟢 All 1 up/)
  assert.match(text, /🟢 Site/)
  assert.match(text, /up 3 days · 1\.21 s · 100\.00% 24h/)
  assert.match(text, /Checked 12 minutes ago/)
})

test('an outage leads, with the reason and how long', () => {
  const text = board(
    [monitor(), monitor({ id: 'other', name: 'Other', url: 'https://other.kz' })],
    {
      site: state(),
      other: state({
        id: 'other',
        status: 'DOWN',
        statusCode: null,
        error: 'Connection timeout',
        since: ago(4),
      }),
    },
  )

  assert.match(text, /^🔴 1 of 2 down/)
  // The failing one is listed first, whatever its name.
  assert.ok(text.indexOf('🔴 Other') < text.indexOf('🟢 Site'))
  assert.match(text, /down 4 hours · Connection timeout/)
})

test('a failure with no message falls back to its status code', () => {
  const text = board([monitor()], {
    site: state({ status: 'DOWN', statusCode: 502, error: null, since: ago(1) }),
  })

  assert.match(text, /down 1 hour · HTTP 502/)
})

test('a monitor nobody has checked yet says so', () => {
  const text = board([monitor()], {})
  assert.match(text, /⚪ Site/)
  assert.match(text, /not checked yet/)
})

test('disabled monitors are not on the board', () => {
  const text = board([monitor(), monitor({ id: 'off', name: 'Off', enabled: false })], {
    site: state(),
  })

  assert.match(text, /All 1 up/)
  assert.ok(!text.includes('Off'))
})

test('an empty configuration says that instead of pretending', () => {
  assert.equal(board([], {}), 'No monitors configured yet.')
})

test('a board built on stale data admits it', () => {
  const text = board([monitor()], { site: state() }, { updatedAt: ago(5) })

  assert.match(text, /Checked 5 hours ago/)
  assert.match(text, /older than it should be/)
})

test('a board with no recorded check at all says that too', () => {
  const text = board([monitor()], { site: state() }, { updatedAt: '' })
  assert.match(text, /No check has been recorded yet/)
})

test('the timestamp carries the configured zone', () => {
  const text = board([monitor()], { site: state() })
  assert.match(text, /GMT\+5/)
})

const chat = { chatId: 42, label: 'Ops', chatType: 'group' }
const empty: SubscribersFile = { offset: 7, subscribers: [] }

test('subscribing adds a chat once', () => {
  const first = subscribe(empty, chat, ago(0))
  assert.equal(first.changed, true)
  assert.equal(first.file.subscribers.length, 1)
  assert.equal(first.file.offset, 7, 'the getUpdates cursor is left alone')

  const again = subscribe(first.file, chat, ago(0))
  assert.equal(again.changed, false)
  assert.equal(again.file.subscribers.length, 1)
})

test('unsubscribing removes only that chat', () => {
  const two = subscribe(subscribe(empty, chat, ago(0)).file, { ...chat, chatId: 43 }, ago(0)).file

  const removed = unsubscribe(two, 42)
  assert.equal(removed.changed, true)
  assert.equal(removed.removed?.label, 'Ops')
  assert.deepEqual(
    removed.file.subscribers.map((entry) => entry.chatId),
    [43],
  )

  const absent = unsubscribe(removed.file, 999)
  assert.equal(absent.changed, false)
})

test('a chat is named by whatever it offers', () => {
  assert.equal(identify({ chat: { id: 1, type: 'group', title: 'Ops' } }).label, 'Ops')
  assert.equal(identify({ chat: { id: 1, type: 'private', username: 'dias' } }).label, 'dias')
  assert.equal(
    identify({ chat: { id: 1, type: 'private' }, from: { first_name: 'Dias' } }).label,
    'Dias',
  )
  // Nothing to go on: the id is still a name of sorts.
  assert.equal(identify({ chat: { id: -100, type: 'supergroup' } }).label, '-100')
})
