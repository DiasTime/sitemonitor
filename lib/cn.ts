import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names. Kept apart from lib/utils on purpose: this is the
 * one helper that needs npm packages, and lib/utils is loaded by the
 * monitoring run, which starts without `npm ci` (see tests/monitor-deps.test.ts).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
