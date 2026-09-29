'use client'

import { useI18n } from '@/components/i18n/i18n-provider'
import { LOCALES } from '@/lib/i18n/config'
import { cn } from '@/lib/cn'

const LABEL = { en: 'EN', ru: 'RU' } as const
const NAME = { en: 'English', ru: 'Русский' } as const

/** Two-letter segmented switch; each option is named in its own language. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t.common.language}
      className={cn('flex items-center rounded-md border border-border bg-card p-0.5', className)}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          aria-pressed={locale === option}
          aria-label={NAME[option]}
          title={NAME[option]}
          onClick={() => option !== locale && setLocale(option)}
          className={cn(
            'rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            locale === option
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {LABEL[option]}
        </button>
      ))}
    </div>
  )
}
