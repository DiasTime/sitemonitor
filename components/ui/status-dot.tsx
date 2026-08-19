import { cn } from '@/lib/utils'
import type { UiStatus } from '@/lib/types'

const TONE: Record<UiStatus, string> = {
  UP: 'bg-up',
  DOWN: 'bg-down',
  CHECKING: 'bg-checking',
}

/** Coloured status dot, with a soft pulse while a check is in flight. */
export function StatusDot({
  status,
  className,
  size = 'md',
}: {
  status: UiStatus
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const dimension = size === 'sm' ? 'h-2 w-2' : size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5'

  return (
    <span className={cn('relative inline-flex shrink-0', dimension, className)}>
      {status === 'CHECKING' && (
        <span
          className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', TONE[status])}
        />
      )}
      <span className={cn('relative inline-flex h-full w-full rounded-full', TONE[status])} />
      <span className="sr-only">{status}</span>
    </span>
  )
}
