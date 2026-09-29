import { cn } from '@/lib/cn'
import type { UiStatus } from '@/lib/types'

const TONE: Record<UiStatus, string> = {
  UP: 'bg-up',
  DOWN: 'bg-down',
  CHECKING: 'bg-checking',
}

/**
 * Coloured status dot, with a soft pulse while a check is in flight.
 *
 * With `pulse`, a down dot also sends out a slow ring — for the places where
 * an outage should pull the eye, like the dashboard list. It is CSS rather
 * than script on purpose: an endless loop gains nothing from a timeline, and
 * this way the dot stays a server component and the ring stops by itself for
 * anyone who asked for reduced motion.
 */
export function StatusDot({
  status,
  className,
  size = 'md',
  pulse = false,
}: {
  status: UiStatus
  className?: string
  size?: 'sm' | 'md' | 'lg'
  pulse?: boolean
}) {
  const dimension = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'

  return (
    <span className={cn('relative inline-flex shrink-0', dimension, className)}>
      {status === 'CHECKING' && (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', TONE[status])}
        />
      )}
      {status === 'DOWN' && pulse && (
        <span
          aria-hidden
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-0 motion-safe:animate-status-pulse',
            TONE[status],
          )}
        />
      )}
      <span className={cn('relative inline-flex h-full w-full rounded-full', TONE[status])} />
      <span className="sr-only">{status}</span>
    </span>
  )
}
