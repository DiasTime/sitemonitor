import type { Monitor, StatusFile, Subscriber, SubscribersFile } from './types'
import { formatDuration, formatFullTimestamp, formatResponseTime, formatUptime } from './utils'

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
    'Subscribed to Site Monitor alerts.',
    '',
    'You will get a message when a site goes down, another when it comes back, ' +
      'and a reminder while an outage is still going. Nothing in between.',
    '',
    'The buttons below are always there: the board, a check on demand, and the ' +
      'way out. /help lists everything.',
  ].join('\n')
}

export function unsubscribedMessage(): string {
  return 'Unsubscribed. Send /start to subscribe again.'
}

export function passphraseRequiredMessage(): string {
  return 'This bot is private. Send /start followed by the passphrase to subscribe.'
}

export function helpMessage(): string {
  return [
    'Site Monitor',
    '',
    '/status — how every monitored site is doing right now',
    '/check — probe every site immediately, without waiting for the schedule',
    '/start — receive alerts in this chat',
    '/stop — stop receiving them',
    '/menu — bring the buttons back',
    '/help — this message',
  ].join('\n')
}

export function menuMessage(): string {
  return 'Site Monitor. Pick something, or type a command — /help lists them all.'
}

export function checkStartedMessage(): string {
  return 'Checking every site now. The board updates in about a minute — /status to see it.'
}

export function checkBusyMessage(): string {
  return 'A check was started moments ago. Give it a minute, then /status.'
}

export function checkRunningMessage(): string {
  return 'A check is running right now — that is how this message reached you. /status in a minute.'
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
  status: '📊 Status',
  check: '🔄 Check now',
  help: '❓ Help',
  stop: '🔕 Stop alerts',
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
        { text: '🔄 Refresh', callback_data: 'status' },
        { text: '▶️ Check now', callback_data: 'check' },
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
  return `Not a command I know.\n\n${helpMessage()}`
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
  if (!enabled.length) return 'No monitors configured yet.'

  const states = status.monitors ?? {}
  const ordered = [...enabled].sort((a, b) => {
    const rank = (monitor: Monitor) => (states[monitor.id]?.status === 'DOWN' ? 0 : 1)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })

  const down = ordered.filter((monitor) => states[monitor.id]?.status === 'DOWN').length
  const lines: string[] = [
    down ? `🔴 ${down} of ${ordered.length} down` : `🟢 All ${ordered.length} up`,
    '',
  ]

  for (const monitor of ordered) {
    const state = states[monitor.id]

    if (!state) {
      lines.push(`⚪ ${monitor.name}`, '   not checked yet', '')
      continue
    }

    const held = formatDuration(Math.max(0, now - new Date(state.since).getTime()))

    if (state.status === 'DOWN') {
      const why = state.error ?? (state.statusCode !== null ? `HTTP ${state.statusCode}` : 'failed')
      lines.push(`🔴 ${monitor.name}`, `   down ${held} · ${why}`, '')
      continue
    }

    const detail = [
      `up ${held}`,
      formatResponseTime(state.responseTime),
      `${formatUptime(state.uptime24h)} 24h`,
    ].join(' · ')
    lines.push(`🟢 ${monitor.name}`, `   ${detail}`, '')
  }

  const checkedAt = status.updatedAt ? new Date(status.updatedAt).getTime() : Number.NaN
  if (Number.isFinite(checkedAt)) {
    const age = Math.max(0, now - checkedAt)
    lines.push(`Checked ${formatDuration(age)} ago — ${formatFullTimestamp(status.updatedAt, options.timeZone)}`)
    // The board is only as true as its last check, and a stalled schedule is
    // exactly when someone thinks to ask.
    if (options.staleAfterMs && age >= options.staleAfterMs) {
      lines.push('', '⚠️ That is older than it should be — nothing has been checked since.')
    }
  } else {
    lines.push('No check has been recorded yet.')
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
