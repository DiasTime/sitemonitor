import type { Bucket, BucketState } from '@/components/ui/uptime-bars'

/**
 * Deterministic sample data for the landing page previews. It is illustrative
 * only and labelled as such on the page; the dashboard renders real history.
 */
export function sampleBuckets(pattern: Partial<Record<number, BucketState>>, count = 60): Bucket[] {
  return Array.from({ length: count }, (_, index) => {
    // No tooltip text: the preview is labelled as sample data as a whole.
    return { state: pattern[index] ?? 'up', label: '' }
  })
}

export const SAMPLE_MONITORS = [
  {
    name: 'Storefront',
    host: 'shop.lumenfield.io',
    kind: 'Website',
    uptime: 99.97,
    response: 184,
    status: 'UP' as const,
    buckets: sampleBuckets({ 41: 'degraded' }),
  },
  {
    name: 'Billing API',
    host: 'api.lumenfield.io/health',
    kind: 'Health',
    uptime: 100,
    response: 92,
    status: 'UP' as const,
    buckets: sampleBuckets({}),
  },
  {
    name: 'Partner portal',
    host: 'partners.lumenfield.io/login',
    kind: 'Login',
    uptime: 98.64,
    response: 1240,
    status: 'DOWN' as const,
    buckets: sampleBuckets({ 17: 'degraded', 57: 'degraded', 58: 'down', 59: 'down' }),
  },
  {
    name: 'Docs',
    host: 'docs.lumenfield.io',
    kind: 'Website',
    uptime: 99.91,
    response: 311,
    status: 'UP' as const,
    buckets: sampleBuckets({ 8: 'degraded', 9: 'degraded' }),
  },
]

/** One outage, drawn as it would appear on the dashboard. */
export const SAMPLE_OUTAGE = sampleBuckets({ 15: 'down', 16: 'down', 17: 'degraded' }, 24)
