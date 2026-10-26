import { jsonResponse } from '@/lib/api'
import { dispatchRepositoryEvent, updateJsonFile } from '@/lib/github'
import { DATA_PATHS, getMonitors, getStatus } from '@/lib/storage'
import {
  EMPTY_SUBSCRIBERS,
  openSubscribers,
  sealSubscribers,
  subscribersKey,
  type StoredSubscribers,
} from '@/lib/subscribers'
import {
  checkBusyMessage,
  checkStartedMessage,
  helpMessage,
  identify,
  mainKeyboard,
  menuMessage,
  parseCallback,
  parseCommand,
  passphraseRequiredMessage,
  statusKeyboard,
  statusMessage,
  subscribe,
  subscribedMessage,
  unknownCommandMessage,
  unsubscribe,
  unsubscribedMessage,
  type InlineKeyboard,
  type ReplyKeyboard,
  type TelegramMessage,
  type TelegramUpdate,
} from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A check on demand is cheap, but not free — it spends an Actions minute. */
const CHECK_COOLDOWN_MS = 60_000
let lastCheckAt = 0

interface Reply {
  text: string
  keyboard?: ReplyKeyboard | InlineKeyboard
}

/**
 * POST /api/telegram — the bot's webhook.
 *
 * Without it the bot is only awake during a monitoring run: it collects
 * messages with getUpdates once an hour, so `/status` would be answered
 * somewhere in the next sixty minutes. Here the dashboard answers in a
 * second, which is the difference between a bot and a suggestion box. It is
 * also the only place inline buttons can work, since Telegram expects a
 * callback to be acknowledged within seconds.
 *
 * Registering it turns getUpdates off at Telegram's end — the run notices and
 * stops polling. See the README.
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  // No secret, no webhook: anyone who guessed the URL could otherwise forge
  // updates and make the bot subscribe or message arbitrary chats.
  if (!secret) {
    return jsonResponse({ error: 'Webhook is not configured' }, { status: 503 })
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return jsonResponse({ error: 'Invalid webhook token' }, { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return jsonResponse({ ok: true, ignored: 'unreadable body' })
  }

  // Telegram retries anything that is not a 2xx, so every branch below ends in
  // an acknowledgement, including the ones with nothing to say.
  try {
    if (update.callback_query) return await handleButton(update.callback_query)

    const message = update.message
    const command = parseCommand(message?.text)
    if (!message || !command) return jsonResponse({ ok: true, ignored: 'nothing to answer' })

    const reply = await answer(command.name, command.argument, message)
    if (reply) await send(message.chat.id, reply)
  } catch (error) {
    console.error('Telegram webhook failed:', error)
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id
    if (chatId) {
      await send(chatId, {
        text: 'Something went wrong answering that. The alerts themselves are unaffected.',
      }).catch(() => {})
    }
  }

  return jsonResponse({ ok: true })
}

async function answer(
  name: string,
  argument: string,
  message: TelegramMessage,
): Promise<Reply | null> {
  const chat = identify(message)

  if (name === 'status') return { text: await board(), keyboard: statusKeyboard() }

  if (name === 'check') return { text: await startCheck() }

  if (name === 'start') {
    const passphrase = process.env.TELEGRAM_SUBSCRIBE_PASSWORD?.trim()
    if (passphrase && argument !== passphrase) return { text: passphraseRequiredMessage() }

    // The commit message names no one: on a public repository it is public.
    const key = subscribersKey()
    await updateJsonFile<StoredSubscribers>(
      DATA_PATHS.subscribers,
      EMPTY_SUBSCRIBERS,
      (current) => {
        const { file, changed } = subscribe(openSubscribers(current, key), chat, new Date().toISOString())
        return changed ? sealSubscribers(file, key) : null
      },
      'chore(monitor): subscribe',
    )
    return { text: subscribedMessage(), keyboard: mainKeyboard() }
  }

  if (name === 'stop') {
    const key = subscribersKey()
    await updateJsonFile<StoredSubscribers>(
      DATA_PATHS.subscribers,
      EMPTY_SUBSCRIBERS,
      (current) => {
        const { file, changed } = unsubscribe(openSubscribers(current, key), chat.chatId)
        return changed ? sealSubscribers(file, key) : null
      },
      'chore(monitor): unsubscribe',
    )
    return { text: unsubscribedMessage() }
  }

  if (name === 'menu') return { text: menuMessage(), keyboard: mainKeyboard() }
  if (name === 'help') return { text: helpMessage(), keyboard: mainKeyboard() }

  return { text: unknownCommandMessage(), keyboard: mainKeyboard() }
}

/** An inline button under a board was tapped. */
async function handleButton(callback: NonNullable<TelegramUpdate['callback_query']>) {
  const action = parseCallback(callback.data)
  const chatId = callback.message?.chat.id
  const messageId = callback.message?.message_id

  if (!action || !chatId || !messageId) {
    // The spinner on the button has to be stopped either way.
    await call('answerCallbackQuery', { callback_query_id: callback.id })
    return jsonResponse({ ok: true, ignored: 'unknown button' })
  }

  if (action === 'check') {
    const text = await startCheck()
    await call('answerCallbackQuery', { callback_query_id: callback.id, text })
    await send(chatId, { text })
    return jsonResponse({ ok: true })
  }

  await call('answerCallbackQuery', { callback_query_id: callback.id, text: 'Refreshed' })
  await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: await board(),
    disable_web_page_preview: true,
    reply_markup: statusKeyboard(),
  })
  return jsonResponse({ ok: true })
}

async function board(): Promise<string> {
  const [{ monitors }, status] = await Promise.all([getMonitors(), getStatus()])
  return statusMessage(monitors, status, Date.now(), {
    staleAfterMs: staleAfterMs(),
    timeZone: process.env.DISPLAY_TIMEZONE,
  })
}

async function startCheck(): Promise<string> {
  if (Date.now() - lastCheckAt < CHECK_COOLDOWN_MS) return checkBusyMessage()

  await dispatchRepositoryEvent('run-check', { loop_minutes: '0' })
  lastCheckAt = Date.now()
  return checkStartedMessage()
}

function staleAfterMs(): number {
  const minutes = Number(process.env.STALE_AFTER_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 90) * 60_000
}

async function send(chatId: number, reply: Reply): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId,
    text: reply.text,
    disable_web_page_preview: true,
    ...(reply.keyboard ? { reply_markup: reply.keyboard } : {}),
  })
}

async function call(method: string, payload: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set on the dashboard — cannot answer the bot.')
    return
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  if (response.ok) return

  const detail = (await response.json().catch(() => ({}))) as { description?: string }
  // Refreshing a board that has not changed since is not an error worth logging.
  if (detail.description?.includes('message is not modified')) return
  console.error(`Telegram ${method} returned ${response.status}: ${detail.description ?? ''}`)
}

/** Kept so an accidental visit in a browser says what this is. */
export async function GET() {
  return jsonResponse({
    ok: true,
    endpoint: 'Telegram webhook',
    configured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
  })
}
