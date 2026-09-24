'use client'

import { ShieldAlert, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { describeSslDaysLeft, sslDaysLeft, sslStage } from '@/lib/ssl'
import { cn } from '@/lib/utils'

/** "1 Oct 2026" in the viewer's locale; the date is a calendar date, so no zone shift. */
function formatExpiry(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(time)) return date
  return new Date(time).toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' })
}

/**
 * Days left on the monitor's SSL certificate: neutral while it is fine, amber
 * inside the warning window, red from the expiry day on. Counted in the
 * viewer's own time zone. Renders nothing when no date is set.
 */
export function SslBadge({ expiresAt, className }: { expiresAt?: string; className?: string }) {
  if (!expiresAt) return null
  const daysLeft = sslDaysLeft(expiresAt, Date.now())
  if (daysLeft === null) return null

  const stage = sslStage(daysLeft)
  const Icon = stage ? ShieldAlert : ShieldCheck

  return (
    <Badge
      variant={stage === 'expired' ? 'down' : stage === 'soon' ? 'warn' : 'outline'}
      className={cn('shrink-0 gap-1', !stage && 'font-normal text-muted-foreground', className)}
      title={`SSL certificate expires ${formatExpiry(expiresAt)}`}
    >
      <Icon className="h-3 w-3" />
      {describeSslDaysLeft(daysLeft)}
    </Badge>
  )
}
