'use client'

import * as React from 'react'

export interface PollState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** True while a background refresh is in flight (data is already on screen). */
  refreshing: boolean
  refresh: () => void
}

/**
 * Fetch a JSON endpoint once and then re-fetch on an interval, without ever
 * reloading the page. Polling pauses while the tab is hidden.
 */
export function usePoll<T>(url: string, intervalMs = 30_000): PollState<T> {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [tick, setTick] = React.useState(0)

  const refresh = React.useCallback(() => setTick((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setRefreshing(true)
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
        const body = await response.json().catch(() => ({}))

        if (cancelled) return
        if (!response.ok) {
          setError(
            typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`,
          )
        } else {
          setData(body as T)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled && (cause as Error).name !== 'AbortError') {
          setError((cause as Error).message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [url, tick])

  React.useEffect(() => {
    if (intervalMs <= 0) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, intervalMs)

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs, refresh])

  return { data, error, loading, refreshing, refresh }
}
