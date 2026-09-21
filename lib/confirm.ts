import type { CheckResult } from './types'

/**
 * Believing a single failed request is how a monitor cries wolf.
 *
 * One dropped packet, one runner with a bad minute, one portal restarting its
 * app pool, and the tool opens an incident and wakes someone up. This module
 * takes a second and third look before a failure is believed — but only at
 * failures a second look could honestly disagree with.
 */

/**
 * Would probing again possibly say something different?
 *
 * The distinction matters most for `login` monitors: re-submitting credentials
 * to a portal that just rejected them is how accounts get locked out. So a
 * failure the far end *answered with* is taken at its word, and only failures
 * of the transport — or of the server admitting its own trouble — are retried.
 */
export function isTransientFailure(
  result: Pick<CheckResult, 'status' | 'statusCode' | 'error'>,
): boolean {
  if (result.status !== 'DOWN') return false

  // Configuration, not weather. These never become UP by asking again, and for
  // a login monitor "no credentials" would just repeat a pointless wait.
  if (/^(Invalid URL|Blocked|No credentials configured)/.test(result.error ?? '')) {
    return false
  }

  // Nothing came back at all: DNS, TLS, connection refused, timeout. The most
  // common false alarm there is, and the cheapest to disprove.
  if (result.statusCode === null) return true

  // The server answered about itself rather than about the request: overloaded,
  // restarting, rate-limiting. Worth another look in ten seconds.
  return result.statusCode >= 500 || result.statusCode === 408 || result.statusCode === 429

  // Everything else — 4xx, a sign-in the portal refused, a health endpoint
  // reporting trouble — is a considered answer from the far end. Asking twice
  // does not make it truer, and for a sign-in it is actively unsafe.
}

export interface ConfirmOptions {
  /** Extra probes after the first failure. 0 believes the first answer. */
  retries: number
  /** Pause between probes. */
  delayMs: number
  /**
   * False skips confirmation entirely — used when the monitor is already down,
   * where another two probes change no decision and only spend the run's time.
   */
  confirm?: boolean
  sleep?: (ms: number) => Promise<void>
  /** Called before each extra probe, with the failure being re-examined. */
  onRetry?: (attempt: number, previous: CheckResult) => void
  /** Called when a retry disagreed with the first answer. */
  onDisagree?: (attempt: number, failure: CheckResult) => void
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Probe until a failure is confirmed, or until one of the retries disagrees.
 *
 * Returns the recovered result as soon as a probe succeeds, and otherwise the
 * last failure — the freshest description of what is wrong.
 */
export async function confirmFailure(
  probe: () => Promise<CheckResult>,
  options: ConfirmOptions,
): Promise<CheckResult> {
  const sleep = options.sleep ?? wait
  let result = await probe()

  if (options.confirm === false) return result

  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    if (!isTransientFailure(result)) return result

    options.onRetry?.(attempt, result)
    await sleep(options.delayMs)

    const retry = await probe()
    if (retry.status === 'UP') {
      options.onDisagree?.(attempt, result)
      return retry
    }
    result = retry
  }

  return result
}
