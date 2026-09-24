import { describe, expect, it } from 'vitest'
import {
  addDays,
  currentMonth,
  formatCalendarDate,
  monthRange,
  parseCalendarDate,
  shiftMonth,
  todayUtc,
} from './calendarDate.ts'

describe('calendar dates', () => {
  it('parses to UTC midnight and formats back', () => {
    const date = parseCalendarDate('2026-09-24')

    expect(date.toISOString()).toBe('2026-09-24T00:00:00.000Z')
    expect(formatCalendarDate(date)).toBe('2026-09-24')
  })

  it('todayUtc drops the time and uses the UTC day', () => {
    const now = new Date('2026-09-24T23:59:59.000Z')

    expect(formatCalendarDate(todayUtc(now))).toBe('2026-09-24')
  })

  it('adds days across month and year ends', () => {
    expect(formatCalendarDate(addDays(parseCalendarDate('2026-12-31'), 1))).toBe('2027-01-01')
    expect(formatCalendarDate(addDays(parseCalendarDate('2026-03-01'), -1))).toBe('2026-02-28')
  })
})

describe('months', () => {
  it('reports the current UTC month', () => {
    expect(currentMonth(new Date('2026-09-24T12:00:00.000Z'))).toBe('2026-09')
  })

  it.each([
    ['2026-09', 1, '2026-10'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -14, '2025-01'],
    ['2026-09', 0, '2026-09'],
  ])('shifts %s by %i to %s', (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected)
  })

  it('returns a half-open range for a month', () => {
    const { start, end } = monthRange('2026-02')

    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })
})
