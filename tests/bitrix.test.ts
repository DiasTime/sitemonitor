import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  Bitrix24Error,
  bitrix24Client,
  bitrix24FromEnv,
  parseSslTaskDays,
  planSslTasks,
  sslTaskComment,
  sslTaskDeadline,
  sslTaskStage,
  sslTaskTitle,
  syncSslTasks,
  type Bitrix24Client,
  type SslTaskTarget,
} from '../lib/bitrix'
import type { Monitor, SslTaskRecord } from '../lib/types'

// 7 Oct 2026, 12:00 UTC.
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)
const DAYS = [30, 14, 7]
const OPTS = { days: DAYS, timeZone: 'UTC' }

function monitor(id: string, url: string, sslExpiresAt?: string, enabled = true): Monitor {
  return { id, name: id, url, enabled, sslExpiresAt }
}

/** The date `days` from NOW. */
function inDays(days: number): string {
  return new Date(NOW + days * 86_400_000).toISOString().slice(0, 10)
}

const TARGET: SslTaskTarget = {
  host: 'zhanaurpaq.kz',
  expiresAt: '2026-11-06',
  daysLeft: 30,
  monitors: [{ name: 'Жана Урпак', url: 'https://zhanaurpaq.kz/' }],
}

// --- configuration ----------------------------------------------------------

test('no webhook means the feature is off, quietly', () => {
  assert.deepEqual(bitrix24FromEnv({}), { config: null })
  assert.deepEqual(bitrix24FromEnv({ B24_WEBHOOK_URL: '  ' }), { config: null })
})

test('a webhook without a responsible person is a problem, not a silent no', () => {
  const read = bitrix24FromEnv({ B24_WEBHOOK_URL: 'https://b24.example/rest/1/key/', B24_RESPONSIBLE_ID: '' })
  assert.equal(read.config, null)
  assert.match(read.problem ?? '', /B24_RESPONSIBLE_ID/)
})

test('the webhook has to be https, since its key travels in the URL', () => {
  const read = bitrix24FromEnv({ B24_WEBHOOK_URL: 'http://b24.example/rest/1/key/', B24_RESPONSIBLE_ID: '5' })
  assert.equal(read.config, null)
  assert.match(read.problem ?? '', /https/)
})

test('a full configuration, with the trailing slash added and the project defaulted', () => {
  const read = bitrix24FromEnv({
    B24_WEBHOOK_URL: 'https://b24.example/rest/276/key',
    B24_RESPONSIBLE_ID: '42',
    B24_GROUP_ID: '',
  })
  assert.deepEqual(read.config, {
    webhookUrl: 'https://b24.example/rest/276/key/',
    groupId: 4272,
    responsibleId: 42,
  })
})

test('thresholds: default, custom, and rubbish falls back to the default', () => {
  assert.deepEqual(parseSslTaskDays(undefined), [7, 5, 3])
  assert.deepEqual(parseSslTaskDays(''), [7, 5, 3])
  assert.deepEqual(parseSslTaskDays('7, 30,14,0'), [30, 14, 7, 0])
  assert.deepEqual(parseSslTaskDays('30,soon'), [7, 5, 3])
  assert.deepEqual(parseSslTaskDays('30,-1'), [7, 5, 3])
})

test('stage is the latest threshold reached', () => {
  const days = [7, 5, 3]
  assert.equal(sslTaskStage(8, days), null)
  assert.equal(sslTaskStage(7, days), 7)
  assert.equal(sslTaskStage(6, days), 7)
  assert.equal(sslTaskStage(5, days), 5)
  assert.equal(sslTaskStage(4, days), 5)
  assert.equal(sslTaskStage(3, days), 3)
  assert.equal(sslTaskStage(-5, days), 3)
})

// --- planning ---------------------------------------------------------------

test('nothing is filed while the certificate is more than 30 days out', () => {
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(31))], {}, NOW, OPTS)
  assert.deepEqual(plan, { records: {}, actions: [] })
})

test('a task is filed when the 30-day window opens', () => {
  const plan = planSslTasks([monitor('a', 'https://a.kz/login', inDays(30))], {}, NOW, OPTS)
  assert.equal(plan.actions.length, 1)
  assert.deepEqual(plan.actions[0], {
    kind: 'create',
    stage: 30,
    target: { host: 'a.kz', expiresAt: inDays(30), daysLeft: 30, monitors: [{ name: 'a', url: 'https://a.kz/login' }] },
  })
})

test('a filed task is not filed again, and the next threshold comments on it', () => {
  const record: SslTaskRecord = { expiresAt: inDays(20), taskId: 101, stage: 30 }
  const quiet = planSslTasks([monitor('a', 'https://a.kz/', inDays(20))], { 'a.kz': record }, NOW, OPTS)
  assert.deepEqual(quiet, { records: { 'a.kz': record }, actions: [] })

  const due = { ...record, expiresAt: inDays(14) }
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(14))], { 'a.kz': due }, NOW, OPTS)
  assert.equal(plan.actions.length, 1)
  assert.equal(plan.actions[0].kind, 'comment')
  assert.equal(plan.actions[0].stage, 14)
  assert.equal(plan.actions[0].kind === 'comment' && plan.actions[0].taskId, 101)
})

test('after the last threshold nothing more is said', () => {
  const record: SslTaskRecord = { expiresAt: inDays(-2), taskId: 101, stage: 7 }
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(-2))], { 'a.kz': record }, NOW, OPTS)
  assert.deepEqual(plan.actions, [])
})

test('a date entered late is filed at once, at the stage it has reached', () => {
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(10))], {}, NOW, OPTS)
  assert.equal(plan.actions[0].kind, 'create')
  assert.equal(plan.actions[0].stage, 14)
})

test('a new date after a renewal drops the old record', () => {
  const record: SslTaskRecord = { expiresAt: inDays(5), taskId: 101, stage: 7 }
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(370))], { 'a.kz': record }, NOW, OPTS)
  assert.deepEqual(plan, { records: {}, actions: [] })
})

test('a paused monitor files nothing but keeps its record', () => {
  const record: SslTaskRecord = { expiresAt: inDays(10), taskId: 101, stage: 30 }
  const plan = planSslTasks([monitor('a', 'https://a.kz/', inDays(10), false)], { 'a.kz': record }, NOW, OPTS)
  assert.deepEqual(plan, { records: { 'a.kz': record }, actions: [] })
})

test('two monitors on one host share one task, about the earlier date', () => {
  const plan = planSslTasks(
    [
      monitor('login', 'https://a.kz/login', inDays(25)),
      monitor('health', 'https://A.kz/api/health', inDays(20)),
    ],
    {},
    NOW,
    OPTS,
  )
  assert.equal(plan.actions.length, 1)
  assert.equal(plan.actions[0].target.host, 'a.kz')
  assert.equal(plan.actions[0].target.expiresAt, inDays(20))
  assert.equal(plan.actions[0].target.monitors.length, 2)
})

test('monitors without a readable date are ignored', () => {
  const plan = planSslTasks(
    [monitor('a', 'https://a.kz/'), monitor('b', 'https://b.kz/', '2026-02-31')],
    {},
    NOW,
    OPTS,
  )
  assert.deepEqual(plan, { records: {}, actions: [] })
})

// --- wording ----------------------------------------------------------------

test('titles all start with the host, so an open task can be found again', () => {
  assert.equal(sslTaskTitle('a.kz', 30), 'SSL: сертификат a.kz истекает через 30 дн.')
  assert.equal(sslTaskTitle('a.kz', 0), 'SSL: сертификат a.kz истекает сегодня')
  assert.equal(sslTaskTitle('a.kz', -3), 'SSL: сертификат a.kz истёк')
})

test('comments say how long is left, with the date', () => {
  assert.match(sslTaskComment({ ...TARGET, daysLeft: 14 }), /истекает через 14 дней \(6 ноября 2026 г\.\)/)
  assert.match(sslTaskComment({ ...TARGET, daysLeft: 0 }), /истекает сегодня/)
  assert.match(sslTaskComment({ ...TARGET, daysLeft: -2 }), /истёк 2 дня назад/)
})

test('deadline: three days before expiry, end of the day, in the display zone', () => {
  assert.equal(sslTaskDeadline('2026-11-06', 30, 'Asia/Almaty'), '2026-11-03T18:00:00+05:00')
  assert.equal(sslTaskDeadline('2026-11-06', 30, 'UTC'), '2026-11-03T18:00:00+00:00')
  assert.equal(sslTaskDeadline('2026-11-06', 30, 'Not/AZone'), '2026-11-03T18:00:00+00:00')
})

test('deadline: never before the day the task is filed', () => {
  assert.equal(sslTaskDeadline('2026-10-09', 2, 'UTC'), '2026-10-07T18:00:00+00:00')
  assert.equal(sslTaskDeadline('2026-10-04', -3, 'UTC'), '2026-10-07T18:00:00+00:00')
})

// --- the client ---------------------------------------------------------------

const CONFIG = { webhookUrl: 'https://b24.example/rest/276/SECRETKEY/', groupId: 4272, responsibleId: 42 }

function fakeFetch(answer: (url: string, body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ url, body })
    const { status = 200, json } = answer(url, body)
    return new Response(JSON.stringify(json), { status })
  }) as typeof fetch
  return { calls, fetchImpl }
}

test('a task is filed in the project, to the responsible person, with the agreed fields', async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({ json: { result: { task: { id: '5551' } } } }))
  const client = bitrix24Client(CONFIG, { timeZone: 'Asia/Almaty', fetch: fetchImpl })

  assert.equal(await client.createTask(TARGET), 5551)
  assert.equal(calls[0].url, 'https://b24.example/rest/276/SECRETKEY/tasks.task.add.json')
  const fields = calls[0].body.fields as Record<string, unknown>
  assert.equal(fields.TITLE, 'SSL: сертификат zhanaurpaq.kz истекает через 30 дн.')
  assert.equal(fields.GROUP_ID, 4272)
  assert.equal(fields.RESPONSIBLE_ID, 42)
  assert.equal(fields.DEADLINE, '2026-11-03T18:00:00+05:00')
  assert.equal(fields.PRIORITY, 2)
  assert.deepEqual(fields.TAGS, ['ssl', 'monitoring'])
  assert.match(String(fields.DESCRIPTION), /Домен: zhanaurpaq\.kz/)
  assert.match(String(fields.DESCRIPTION), /Жана Урпак — https:\/\/zhanaurpaq\.kz\//)
})

test('an open task is found by its title, not by a longer host that contains it', async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({
    json: {
      result: {
        tasks: [
          { id: '9', title: 'SSL: сертификат a.kz.example истекает через 30 дн.' },
          { id: '7', title: 'SSL: сертификат a.kz истекает через 30 дн.' },
        ],
      },
    },
  }))
  const client = bitrix24Client(CONFIG, { fetch: fetchImpl })

  assert.equal(await client.findOpenTask('a.kz'), 7)
  assert.deepEqual(calls[0].body.filter, { GROUP_ID: 4272, '%TITLE': 'SSL: сертификат a.kz', '!STATUS': 5 })
})

test('a comment goes to the task by id', async () => {
  const { calls, fetchImpl } = fakeFetch(() => ({ json: { result: 77 } }))
  await bitrix24Client(CONFIG, { fetch: fetchImpl }).addComment(101, 'текст')
  assert.equal(calls[0].url, 'https://b24.example/rest/276/SECRETKEY/task.commentitem.add.json')
  assert.deepEqual(calls[0].body, { TASKID: 101, FIELDS: { POST_MESSAGE: 'текст' } })
})

test('a refused webhook is fatal; a refused task is not; neither quotes the key', async () => {
  const denied = fakeFetch(() => ({ status: 401, json: { error: 'INVALID_CREDENTIALS', error_description: 'Invalid request credentials' } }))
  await assert.rejects(bitrix24Client(CONFIG, { fetch: denied.fetchImpl }).countOpenSslTasks(), (error: unknown) => {
    assert.ok(error instanceof Bitrix24Error)
    assert.equal(error.fatal, true)
    assert.doesNotMatch(error.message, /SECRETKEY/)
    return true
  })

  const refused = fakeFetch(() => ({ status: 400, json: { error: 'ERROR_CORE', error_description: 'Task not found' } }))
  await assert.rejects(bitrix24Client(CONFIG, { fetch: refused.fetchImpl }).addComment(1, 'x'), (error: unknown) => {
    assert.ok(error instanceof Bitrix24Error)
    assert.equal(error.fatal, false)
    assert.match(error.message, /Task not found/)
    return true
  })
})

test('an unreachable portal is fatal and does not quote the key', async () => {
  const fetchImpl = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  await assert.rejects(bitrix24Client(CONFIG, { fetch: fetchImpl }).findOpenTask('a.kz'), (error: unknown) => {
    assert.ok(error instanceof Bitrix24Error)
    assert.equal(error.fatal, true)
    assert.doesNotMatch(error.message, /SECRETKEY/)
    return true
  })
})

// --- carrying the plan out ----------------------------------------------------

function fakeClient(overrides: Partial<Bitrix24Client> = {}) {
  const calls: string[] = []
  const client: Bitrix24Client = {
    async findOpenTask(host) {
      calls.push(`find ${host}`)
      return null
    },
    async createTask(target) {
      calls.push(`create ${target.host}`)
      return 500
    },
    async addComment(taskId) {
      calls.push(`comment ${taskId}`)
    },
    async countOpenSslTasks() {
      return 0
    },
    ...overrides,
  }
  return { calls, client }
}

const quietLog = () => {}

test('a new task is filed only after checking for an open one', async () => {
  const { calls, client } = fakeClient()
  const plan = { records: {}, actions: [{ kind: 'create' as const, target: TARGET, stage: 30 }] }
  const records = await syncSslTasks(plan, client, quietLog)
  assert.deepEqual(calls, ['find zhanaurpaq.kz', 'create zhanaurpaq.kz'])
  assert.deepEqual(records, { 'zhanaurpaq.kz': { expiresAt: '2026-11-06', taskId: 500, stage: 30 } })
})

test('an open task is reused and commented, not duplicated', async () => {
  const { calls, client } = fakeClient({
    async findOpenTask() {
      calls.push('find')
      return 321
    },
  })
  const plan = { records: {}, actions: [{ kind: 'create' as const, target: TARGET, stage: 30 }] }
  const records = await syncSslTasks(plan, client, quietLog)
  assert.deepEqual(calls, ['find', 'comment 321'])
  assert.equal(records['zhanaurpaq.kz'].taskId, 321)
})

test('a fatal failure stops the run and keeps the records as they were', async () => {
  const { calls, client } = fakeClient({
    async findOpenTask() {
      calls.push('find')
      throw new Bitrix24Error('tasks.task.list: timed out', true)
    },
  })
  const kept: SslTaskRecord = { expiresAt: '2026-10-20', taskId: 9, stage: 30 }
  const plan = {
    records: { 'b.kz': kept },
    actions: [
      { kind: 'create' as const, target: TARGET, stage: 30 },
      { kind: 'comment' as const, target: { ...TARGET, host: 'b.kz', daysLeft: 13 }, stage: 14, taskId: 9 },
    ],
  }
  const records = await syncSslTasks(plan, client, quietLog)
  assert.deepEqual(calls, ['find'], 'nothing after a fatal failure')
  assert.deepEqual(records, { 'b.kz': kept })
})

test('a comment the portal refuses forgets the task, so the next run starts afresh', async () => {
  const { client } = fakeClient({
    async addComment() {
      throw new Bitrix24Error('task.commentitem.add: Task not found', false)
    },
  })
  const plan = {
    records: { 'zhanaurpaq.kz': { expiresAt: '2026-11-06', taskId: 9, stage: 30 } },
    actions: [{ kind: 'comment' as const, target: { ...TARGET, daysLeft: 14 }, stage: 14, taskId: 9 }],
  }
  assert.deepEqual(await syncSslTasks(plan, client, quietLog), {})
})
