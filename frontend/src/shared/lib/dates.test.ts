import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  currentMonthIso,
  daysBetween,
  formatDate,
  formatMonth,
  shiftMonthIso,
  todayIso,
} from './dates'

describe('dates', () => {
  it('todayIso uses the local calendar day', () => {
    expect(todayIso(new Date(2026, 8, 24, 23, 59))).toBe('2026-09-24')
    expect(todayIso(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05')
  })

  it('adds days across month and year ends and back', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('counts whole days between two dates, including negative and across DST', () => {
    expect(daysBetween('2026-09-24', '2026-09-27')).toBe(3)
    expect(daysBetween('2026-09-27', '2026-09-24')).toBe(-3)
    expect(daysBetween('2026-03-01', '2026-11-01')).toBe(245)
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0)
  })

  it('formats a calendar date without shifting it by the time zone', () => {
    expect(formatDate('2026-09-24', 'en-US')).toBe('Sep 24, 2026')
    expect(formatDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026')
  })
})

describe('months', () => {
  it('reports the current local month', () => {
    expect(currentMonthIso(new Date(2026, 8, 24))).toBe('2026-09')
  })

  it.each([
    ['2026-09', 1, '2026-10'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -14, '2025-01'],
  ])('shifts %s by %i to %s', (month, delta, expected) => {
    expect(shiftMonthIso(month, delta)).toBe(expected)
  })

  it('formats a month', () => {
    expect(formatMonth('2026-09', 'en-US')).toBe('September 2026')
  })
})
