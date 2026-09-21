import { jsonResponse } from '@/lib/api'
import { updateJsonFile } from '@/lib/github'
import { DATA_PATHS, getMonitors, getStatus } from '@/lib/storage'
import {
  helpMessage,
  identify,
  parseCommand,
  passphraseRequiredMessage,
  statusMessage,
  subscribe,
  subscribedMessage,
  unknownCommandMessage,
  unsubscribe,
  unsubscribedMessage,
  type TelegramUpdate,
} from '@/lib/telegram'
import type { SubscribersFile } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMPTY_SUBSCRIBERS: SubscribersFile = { offset: 0, subscribers: [] }

/**
 * POST /api/telegram — the bot's webhook.
 *
 * Without it the bot is only awake during a monitoring run: it collects
 * messages with getUpdates once an hour, so `/status` would be answered
 * somewhere in the next sixty minutes. Here the dashboard answers in a
 * second, which is the difference between a bot and a suggestion box.
 *
 * Registering it also turns getUpdates off at Telegram's end — the run
 * notices and stops polling. See the README.
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

  const message = update.message
  const command = parseCommand(message?.text)
  // Telegram retries anything that is not a 2xx, so everything the bot has no
  // answer for is still acknowledged.
  if (!message || !command) return jsonResponse({ ok: true, ignored: 'nothing to answer' })

  try {
    const reply = await answer(command.name, command.argument, message)
    if (reply) await send(message.chat.id, reply)
  } catch (error) {
    console.error('Telegram webhook failed:', error)
    await send(
      message.chat.id,
      'Something went wrong answering that. The alerts themselves are unaffected.',
    ).catch(() => {})
  }

  return jsonResponse({ ok: true })
}

async function answer(
  name: string,
  argument: string,
  message: NonNullable<TelegramUpdate['message']>,
): Promise<string | null> {
  const chat = identify(message)

  if (name === 'status') {
    const [{ monitors }, status] = await Promise.all([getMonitors(), getStatus()])
    return statusMessage(monitors, status, Date.now(), {
      staleAfterMs: staleAfterMs(),
      timeZone: process.env.DISPLAY_TIMEZONE,
    })
  }

  if (name === 'start') {
    const passphrase = process.env.TELEGRAM_SUBSCRIBE_PASSWORD?.trim()
    if (passphrase && argument !== passphrase) return passphraseRequiredMessage()

    await updateJsonFile<SubscribersFile>(
      DATA_PATHS.subscribers,
      EMPTY_SUBSCRIBERS,
      (current) => {
        const { file, changed } = subscribe(normalise(current), chat, new Date().toISOString())
        return changed ? file : null
      },
      `chore(monitor): subscribe ${chat.label}`,
    )
    return subscribedMessage()
  }

  if (name === 'stop') {
    await updateJsonFile<SubscribersFile>(
      DATA_PATHS.subscribers,
      EMPTY_SUBSCRIBERS,
      (current) => {
        const { file, changed } = unsubscribe(normalise(current), chat.chatId)
        return changed ? file : null
      },
      `chore(monitor): unsubscribe ${chat.label}`,
    )
    return unsubscribedMessage()
  }

  if (name === 'help') return helpMessage()

  return unknownCommandMessage()
}

/** A hand-edited or half-written subscribers.json must not throw here. */
function normalise(file: SubscribersFile): SubscribersFile {
  return {
    offset: typeof file?.offset === 'number' ? file.offset : 0,
    subscribers: Array.isArray(file?.subscribers) ? file.subscribers : [],
  }
}

function staleAfterMs(): number {
  const minutes = Number(process.env.STALE_AFTER_MINUTES)
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 90) * 60_000
}

async function send(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set on the dashboard — cannot answer the bot.')
    return
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    cache: 'no-store',
  })

  if (!response.ok) {
    console.error(`Telegram sendMessage returned ${response.status}`)
  }
}

/** Kept so an accidental visit in a browser says what this is. */
export async function GET() {
  return jsonResponse({
    ok: true,
    endpoint: 'Telegram webhook',
    configured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
  })
}
