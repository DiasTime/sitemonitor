import type { Monitor, StatusFile, Subscriber, SubscribersFile } from './types'
import { formatDurationRu, formatResponseTimeRu, formatUptimeRu } from './ru'
import { formatFullTimestamp } from './utils'

/**
 * What the bot understands, and what it says back.
 *
 * Two different processes talk to Telegram: the monitoring run, which polls
 * for messages once an hour, and the dashboard's webhook, which answers in a
 * second. They must say exactly the same things, so the wording and the
 * subscriber bookkeeping live here rather than in either of them.
 */

export interface Command {
  /** Lower-case, without the slash or the @botname suffix. */
  name: string
  /** Everything after the command, trimmed. */
  argument: string
}

/**
 * `/status@SiteMonitorBot now` -> { name: 'status', argument: 'now' }
 *
 * A tap on the keyboard below arrives as ordinary text, so the button labels
 * are commands too.
 */
export function parseCommand(text: string | null | undefined): Command | null {
  if (typeof text !== 'string') return null

  const trimmed = text.trim()
  const fromButton = BUTTON_COMMANDS.get(trimmed)
  if (fromButton) return { name: fromButton, argument: '' }

  const match = /^\/([a-z_]+)(?:@\S+)?\s*([\s\S]*)$/i.exec(trimmed)
  if (!match) return null
  return { name: match[1].toLowerCase(), argument: match[2].trim() }
}

export function subscribedMessage(): string {
  return [
    'Оповещения Site Monitor включены.',
    '',
    'Придёт сообщение, когда сайт перестанет отвечать, и ещё одно, когда он ' +
      'вернётся, плюс напоминания, пока авария продолжается. Между этим — тишина.',
    '',
    'Кнопки снизу всегда на месте: сводка, проверка по требованию и выход. ' +
      'Полный список команд — /help.',
  ].join('\n')
}

export function unsubscribedMessage(): string {
  return 'Оповещения отключены. Чтобы включить снова — /start.'
}

export function passphraseRequiredMessage(): string {
  return 'Бот закрытый. Отправьте /start и кодовое слово через пробел.'
}

export function helpMessage(): string {
  return [
    'Site Monitor',
    '',
    '/status — как сейчас чувствуют себя все сайты',
    '/check — проверить все сайты сейчас, не дожидаясь расписания',
    '/start — получать оповещения в этот чат',
    '/stop — перестать их получать',
    '/menu — вернуть кнопки',
    '/help — это сообщение',
  ].join('\n')
}

export function menuMessage(): string {
  return 'Site Monitor. Нажмите кнопку или наберите команду — список в /help.'
}

export function checkStartedMessage(): string {
  return 'Проверяю все сайты. Сводка обновится примерно через минуту — /status.'
}

export function checkBusyMessage(): string {
  return 'Проверка запущена только что. Подождите минуту и посмотрите /status.'
}

export function checkRunningMessage(): string {
  return 'Проверка идёт прямо сейчас — именно она и принесла это сообщение. /status через минуту.'
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/**
 * The persistent keyboard sits under the input box and sends plain text when
 * tapped, so it works whether the bot is polled by the run or answered by the
 * webhook. Inline buttons, which need callbacks answered within seconds, are
 * only offered by the webhook.
 */
export const BUTTONS = {
  status: '📊 Сводка',
  check: '🔄 Проверить',
  help: '❓ Помощь',
  stop: '🔕 Отключить',
} as const

/** Button label -> the command it stands for. */
const BUTTON_COMMANDS = new Map<string, string>([
  [BUTTONS.status, 'status'],
  [BUTTONS.check, 'check'],
  [BUTTONS.help, 'help'],
  [BUTTONS.stop, 'stop'],
])

export interface ReplyKeyboard {
  keyboard: Array<Array<{ text: string }>>
  resize_keyboard: true
  is_persistent: true
}

export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
}

export function mainKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: BUTTONS.status }, { text: BUTTONS.check }],
      [{ text: BUTTONS.help }, { text: BUTTONS.stop }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  }
}

/** Offered under a board, so it can be refreshed without typing anything. */
export function statusKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Обновить', callback_data: 'status' },
        { text: '▶️ Проверить', callback_data: 'check' },
      ],
    ],
  }
}

/** Callback payloads are free-form strings; only these two mean anything. */
export function parseCallback(data: string | null | undefined): 'status' | 'check' | null {
  return data === 'status' || data === 'check' ? data : null
}

/** Sent when a chat says something that is not a command the bot knows. */
export function unknownCommandMessage(): string {
  return `Такой команды я не знаю.\n\n${helpMessage()}`
}

export interface StatusMessageOptions {
  /** How old the data has to be before the reply says so. */
  staleAfterMs?: number
  /** IANA zone for the timestamp; falls back to DISPLAY_TIMEZONE, then UTC. */
  timeZone?: string
}

/**
 * The board: every enabled monitor, worst first, with how long it has been in
 * that state.
 */
export function statusMessage(
  monitors: Monitor[],
  status: StatusFile,
  now: number,
  options: StatusMessageOptions = {},
): string {
  const enabled = monitors.filter((monitor) => monitor.enabled !== false)
  if (!enabled.length) return 'Мониторы ещё не настроены.'

  const states = status.monitors ?? {}
  const ordered = [...enabled].sort((a, b) => {
    const rank = (monitor: Monitor) => (states[monitor.id]?.status === 'DOWN' ? 0 : 1)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })

  const down = ordered.filter((monitor) => states[monitor.id]?.status === 'DOWN').length
  const lines: string[] = [
    down ? `🔴 Не отвечает ${down} из ${ordered.length}` : `🟢 Работают все ${ordered.length}`,
    '',
  ]

  for (const monitor of ordered) {
    const state = states[monitor.id]

    if (!state) {
      lines.push(`⚪ ${monitor.name}`, '   ещё не проверялся', '')
      continue
    }

    const held = formatDurationRu(Math.max(0, now - new Date(state.since).getTime()))

    if (state.status === 'DOWN') {
      const why = state.error ?? (state.statusCode !== null ? `HTTP ${state.statusCode}` : 'не отвечает')
      lines.push(`🔴 ${monitor.name}`, `   не отвечает ${held} · ${why}`, '')
      continue
    }

    const detail = [
      `работает ${held}`,
      formatResponseTimeRu(state.responseTime),
      `${formatUptimeRu(state.uptime24h)} за сутки`,
    ].join(' · ')
    lines.push(`🟢 ${monitor.name}`, `   ${detail}`, '')
  }

  const checkedAt = status.updatedAt ? new Date(status.updatedAt).getTime() : Number.NaN
  if (Number.isFinite(checkedAt)) {
    const age = Math.max(0, now - checkedAt)
    lines.push(`Проверено ${formatDurationRu(age)} назад — ${formatFullTimestamp(status.updatedAt, options.timeZone)}`)
    // The board is only as true as its last check, and a stalled schedule is
    // exactly when someone thinks to ask.
    if (options.staleAfterMs && age >= options.staleAfterMs) {
      lines.push('', '⚠️ Это дольше, чем должно быть: с тех пор проверок не было.')
    }
  } else {
    lines.push('Ни одной проверки пока не записано.')
  }

  return lines.join('\n').trimEnd()
}

export interface TelegramMessage {
  text?: string
  chat: { id: number; type: string; title?: string; username?: string; first_name?: string }
  from?: { username?: string; first_name?: string }
}

export interface TelegramCallbackQuery {
  id: string
  data?: string
  message?: TelegramMessage & { message_id: number }
  from?: { username?: string; first_name?: string }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  /** Only ever delivered to the webhook — an inline button was tapped. */
  callback_query?: TelegramCallbackQuery
}

export interface ChatIdentity {
  chatId: number
  label: string
  chatType: string
}

/** Best-effort name for the log and the dashboard — never used for delivery. */
export function identify(message: TelegramMessage): ChatIdentity {
  const chat = message.chat
  return {
    chatId: chat.id,
    label:
      chat.title ||
      chat.username ||
      chat.first_name ||
      message.from?.username ||
      message.from?.first_name ||
      String(chat.id),
    chatType: chat.type,
  }
}

/** Add a chat to the alert list, if it is not already on it. */
export function subscribe(
  file: SubscribersFile,
  chat: ChatIdentity,
  at: string,
): { file: SubscribersFile; changed: boolean } {
  if (file.subscribers.some((entry) => entry.chatId === chat.chatId)) {
    return { file, changed: false }
  }

  const subscriber: Subscriber = {
    chatId: chat.chatId,
    label: chat.label,
    chatType: chat.chatType,
    addedAt: at,
  }
  return {
    file: { ...file, subscribers: [...file.subscribers, subscriber] },
    changed: true,
  }
}

/** Remove a chat from the alert list, if it is on it. */
export function unsubscribe(
  file: SubscribersFile,
  chatId: number,
): { file: SubscribersFile; changed: boolean; removed?: Subscriber } {
  const removed = file.subscribers.find((entry) => entry.chatId === chatId)
  if (!removed) return { file, changed: false }

  return {
    file: { ...file, subscribers: file.subscribers.filter((entry) => entry.chatId !== chatId) },
    changed: true,
    removed,
  }
}
