import { cn } from '@/lib/cn'

/**
 * Wordmark: a small square "beacon" and the product name. `collapse` keeps
 * only the beacon on phones, where a header has no room left for the name.
 */
export function Brand({ className, collapse = false }: { className?: string; collapse?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
        <span className="h-2 w-2 rounded-full bg-up shadow-[0_0_0_3px_hsl(var(--up)/0.25)]" />
      </span>
      <span className={cn('text-[15px] font-semibold tracking-[-0.02em]', collapse && 'max-sm:sr-only')}>Site Monitor</span>
    </span>
  )
}
