'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from '@/lib/i18n/config'
import { createFormatters, type Formatters } from '@/lib/i18n/format'
import { getMessages, type Messages } from '@/lib/i18n/messages'

interface I18nContextValue {
  locale: Locale
  t: Messages
  format: Formatters
  setLocale: (locale: Locale) => void
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

/**
 * The locale is decided on the server (see lib/i18n/server.ts) and handed down,
 * so server and client render the same language and nothing flashes.
 */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const router = useRouter()

  const setLocale = React.useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
      document.documentElement.lang = next
      router.refresh()
    },
    [router],
  )

  const value = React.useMemo(
    () => ({ locale, t: getMessages(locale), format: createFormatters(locale), setLocale }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}
