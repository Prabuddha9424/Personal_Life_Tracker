import { formatMonth } from '@/shared/lib/dates'

/** "last 6 months", or "6 months to May 2026" when the window ends at a month the person chose. */
export function windowLabel(months: number, to?: string): string {
  return to === undefined ? `last ${months} months` : `${months} months to ${formatMonth(to)}`
}
