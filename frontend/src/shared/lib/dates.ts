const DAY_MS = 86_400_000

function toUtcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`)
}

/** The user's local calendar day as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS)
}

export function formatDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toUtcMs(iso)))
}

export function currentMonthIso(now: Date = new Date()): string {
  return todayIso(now).slice(0, 7)
}

export function shiftMonthIso(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  const shiftedYear = String(Math.floor(index / 12)).padStart(4, '0')
  return `${shiftedYear}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function formatMonth(month: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(toUtcMs(`${month}-01`)))
}
