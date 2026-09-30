import { Send } from 'lucide-react'

import { Button } from '@/components/ui/button'

export const TELEGRAM_BOT_URL = 'https://t.me/dias_site_monitor_bot'

/**
 * A link to the alert bot. `compact` is the icon-only form for toolbars;
 * otherwise the word "Telegram" shows from `sm` up and the icon carries it on
 * phones.
 */
export function TelegramButton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <Button asChild variant={compact ? 'ghost' : 'outline'} size={compact ? 'icon' : 'sm'} className={compact ? undefined : 'max-sm:w-8 max-sm:px-0'}>
      <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
        <Send />
        {!compact && <span className="hidden sm:inline">Telegram</span>}
      </a>
    </Button>
  )
}
