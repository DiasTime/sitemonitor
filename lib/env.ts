/**
 * Reading numbers out of the environment, with one trap in mind.
 *
 * A workflow that passes `FOO: ${{ vars.FOO }}` for a repository variable
 * nobody has defined does not leave FOO unset — it sets it to the empty
 * string. And `Number('')` is 0, not NaN. So a setting where 0 is meaningful
 * ("no retries", "no reminders") would read an undefined variable as a
 * deliberate zero and quietly switch the feature off. That is exactly what
 * happened to CONFIRM_RETRIES and REMINDER_INTERVAL_MINUTES: both shipped
 * disabled.
 *
 * Hence: blank means unset, everywhere.
 */

type Env = Record<string, string | undefined>

function raw(env: Env, name: string): string | null {
  const value = env[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** A number that has to be greater than zero to mean anything. */
export function numberFromEnv(name: string, fallback: number, env: Env = process.env): number {
  const text = raw(env, name)
  if (text === null) return fallback
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** A count, where 0 is a real setting rather than "unset". */
export function countFromEnv(name: string, fallback: number, env: Env = process.env): number {
  const text = raw(env, name)
  if (text === null) return fallback
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}
