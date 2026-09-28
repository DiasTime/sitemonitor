import 'server-only'

import { cookies, headers } from 'next/headers'

import { LOCALE_COOKIE, resolveLocale, type Locale } from '@/lib/i18n/config'

/** The request's interface language: saved cookie first, then Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get('accept-language'))
}
