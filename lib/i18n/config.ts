/** Interface languages. English stays the default; Russian matches the Telegram bot. */
export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'sm_locale'
/** One year: a language choice is not something to ask about again. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * The saved choice wins; without one, the browser's preferred languages
 * decide, so a Russian-speaking visitor lands on Russian the first time.
 */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie
  if (!acceptLanguage) return DEFAULT_LOCALE

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';')
      const q = params.find((param) => param.trim().startsWith('q='))
      return { base: tag.split('-')[0], q: q ? Number(q.trim().slice(2)) || 0 : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { base } of ranked) {
    if (isLocale(base)) return base
    // Kazakh and other CIS-language browsers are far likelier to read Russian than English.
    if (base === 'kk' || base === 'ky' || base === 'uz' || base === 'be') return 'ru'
  }
  return DEFAULT_LOCALE
}

/** BCP 47 tag for Intl. English keeps the viewer's own date conventions, as before. */
export function intlLocale(locale: Locale): string | undefined {
  return locale === 'ru' ? 'ru-RU' : undefined
}
