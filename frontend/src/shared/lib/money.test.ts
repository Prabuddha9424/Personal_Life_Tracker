import { describe, expect, it } from 'vitest'
import { formatMinorUnits, minorToMajor, minorUnitDigits, toMinorUnits } from './money'

describe('minorUnitDigits', () => {
  it.each([
    ['USD', 2],
    ['JPY', 0],
    ['BHD', 3],
  ])('%s has %i decimals', (currency, digits) => {
    expect(minorUnitDigits(currency)).toBe(digits)
  })
})

describe('toMinorUnits', () => {
  it.each([
    ['12.34', 'USD', 1234],
    ['12', 'USD', 1200],
    ['0.05', 'USD', 5],
    ['1,234.50', 'USD', 123450],
    ['12,50', 'USD', 1250],
    ['1.234,50', 'EUR', 123450],
    ['12.345.678,9', 'EUR', 1234567890],
    ['500', 'JPY', 500],
    ['1.234', 'BHD', 1234],
    [' 7.5 ', 'USD', 750],
  ])('parses %j in %s to %i', (input, currency, expected) => {
    expect(toMinorUnits(input, currency)).toBe(expected)
  })

  it.each([
    ['', 'USD'],
    ['abc', 'USD'],
    ['-5', 'USD'],
    ['1.234', 'USD'],
    ['5.5', 'JPY'],
    ['1.2345', 'BHD'],
    ['12.3.4', 'USD'],
    ['9007199254740993', 'USD'],
  ])('rejects %j in %s instead of rounding it', (input, currency) => {
    expect(toMinorUnits(input, currency)).toBeNull()
  })

  it.each([
    ['1,234', 'USD', 123400],
    ['1,234', 'JPY', 1234],
    ['1,234,567', 'BHD', 1234567000],
    ['1,234.567', 'BHD', 1234567],
    ['0,500', 'BHD', 500],
    ['12,5', 'BHD', 12500],
    ['007', 'USD', 700],
  ])('resolves the comma form %j in %s to %i', (input, currency, expected) => {
    expect(toMinorUnits(input, currency)).toBe(expected)
  })

  it.each([
    ['1,234', 'BHD'],
    ['0,500', 'USD'],
    ['0,123', 'USD'],
    ['12.500', 'USD'],
    ['1.234.567', 'EUR'],
    ['   ', 'USD'],
  ])('rejects the ambiguous or invalid form %j in %s', (input, currency) => {
    expect(toMinorUnits(input, currency)).toBeNull()
  })

  it('never produces a float', () => {
    expect(Number.isInteger(toMinorUnits('0.29', 'USD'))).toBe(true)
    expect(toMinorUnits('0.29', 'USD')).toBe(29)
    expect(toMinorUnits('1.15', 'USD')).toBe(115)
  })
})

describe('formatMinorUnits', () => {
  it('formats with the currency symbol and separators', () => {
    expect(formatMinorUnits(123456, 'USD', 'en-US')).toBe('$1,234.56')
    expect(formatMinorUnits(500, 'JPY', 'en-US')).toBe('¥500')
    expect(formatMinorUnits(1234, 'BHD', 'en-US')).toContain('1.234')
    expect(formatMinorUnits(-4250, 'USD', 'en-US')).toBe('-$42.50')
  })
})

describe('minorToMajor', () => {
  it('scales by the currency exponent for display', () => {
    expect(minorToMajor(1234, 'USD')).toBe(12.34)
    expect(minorToMajor(500, 'JPY')).toBe(500)
    expect(minorToMajor(1234, 'BHD')).toBe(1.234)
  })
})
