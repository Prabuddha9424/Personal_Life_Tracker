const DAY_MS = 86_400_000

/** `YYYY-MM-DD` to a Date at UTC midnight. Validate the string first (calendarDateSchema). */
export function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The UTC calendar day of `now`, at midnight. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

export function currentMonth(now: Date = new Date()): string {
  return formatCalendarDate(now).slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  const shiftedYear = Math.floor(index / 12)
  const shiftedMonth = (index % 12) + 1
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}`
}

/** `[start, end)` for a `YYYY-MM` month, both at UTC midnight. */
export function monthRange(month: string): { start: Date; end: Date } {
  return {
    start: parseCalendarDate(`${month}-01`),
    end: parseCalendarDate(`${shiftMonth(month, 1)}-01`),
  }
}
