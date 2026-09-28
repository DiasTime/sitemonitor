import { cn } from '@/lib/utils'

/** Wordmark: a small square "beacon" and the product name. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
        <span className="h-2 w-2 rounded-full bg-up shadow-[0_0_0_3px_hsl(var(--up)/0.25)]" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.02em]">Site Monitor</span>
    </span>
  )
}
