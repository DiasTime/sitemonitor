'use client'

import { ShieldAlert, ShieldCheck } from 'lucide-react'

import { useI18n } from '@/components/i18n/i18n-provider'
import { Badge } from '@/components/ui/badge'
import type { Messages } from '@/lib/i18n/messages'
import { sslDaysLeft, sslStage } from '@/lib/ssl'
import { cn } from '@/lib/utils'

/** Same wording rules as `describeSslDaysLeft` in lib/ssl, in the interface language. */
function describe(daysLeft: number, t: Messages['ssl']): string {
  if (daysLeft === 0) return t.today
  if (daysLeft === 1) return t.tomorrow
  if (daysLeft > 1) return t.inDays(daysLeft)
  return t.expiredAgo(-daysLeft)
}

/**
 * Days left on the monitor's SSL certificate: neutral while it is fine, amber
 * inside the warning window, red from the expiry day on. Counted in the
 * viewer's own time zone. Renders nothing when no date is set.
 */
export function SslBadge({ expiresAt, className }: { expiresAt?: string; className?: string }) {
  const { t, format } = useI18n()
  if (!expiresAt) return null
  const daysLeft = sslDaysLeft(expiresAt, Date.now())
  if (daysLeft === null) return null

  const stage = sslStage(daysLeft)
  const Icon = stage ? ShieldAlert : ShieldCheck

  return (
    <Badge
      variant={stage === 'expired' ? 'down' : stage === 'soon' ? 'warn' : 'outline'}
      className={cn('shrink-0 gap-1', !stage && 'font-normal text-muted-foreground', className)}
      title={t.ssl.expiresOn(format.calendarDate(expiresAt))}
    >
      <Icon className="h-3 w-3" />
      {describe(daysLeft, t.ssl)}
    </Badge>
  )
}
