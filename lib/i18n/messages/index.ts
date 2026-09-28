import type { Locale } from '@/lib/i18n/config'
import { en, type Messages } from '@/lib/i18n/messages/en'
import { ru } from '@/lib/i18n/messages/ru'

const MESSAGES: Record<Locale, Messages> = { en, ru }

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale]
}

export type { Messages }
