import { describe, expect, it } from 'vitest'
import {
  isReportableDate,
  makeTransactionFormSchema,
  toFormValues,
  toTransactionInput,
} from './transactionForm'
import type { Transaction } from './types'

const valid = {
  kind: 'expense',
  amount: '12.50',
  categoryId: 'cat1',
  date: '2026-09-15',
  note: 'Lunch',
} as const

function messages(currency: string, override: Record<string, string>): string[] {
  const result = makeTransactionFormSchema(currency).safeParse({ ...valid, ...override })
  return result.error?.issues.map((issue) => issue.message) ?? []
}

describe('makeTransactionFormSchema', () => {
  const usd = makeTransactionFormSchema('USD')

  it('accepts a valid expense', () => {
    expect(usd.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['an empty amount', { amount: '' }, 'Enter an amount'],
    ['a blank amount', { amount: '   ' }, 'Enter an amount'],
    ['text for an amount', { amount: 'abc' }, 'Enter a valid amount in USD'],
    ['too many decimals', { amount: '1.234' }, 'Enter a valid amount in USD'],
    ['a zero amount', { amount: '0' }, 'Amount must be greater than zero'],
    ['a zero amount with decimals', { amount: '0.00' }, 'Amount must be greater than zero'],
    ['a negative amount', { amount: '-5' }, 'Enter a valid amount in USD'],
    ['an exponent', { amount: '1e3' }, 'Enter a valid amount in USD'],
    ['a huge amount', { amount: '99999999999999' }, 'Amount is too large'],
    ['an amount just over the limit', { amount: '10000000000.01' }, 'Amount is too large'],
    ['no category', { categoryId: '' }, 'Choose a category'],
    ['an empty date', { date: '' }, 'Choose a date'],
    ['an impossible date', { date: '2026-02-31' }, 'Choose a date'],
    ['a date before 2000', { date: '1999-12-31' }, 'Choose a date between 2000 and 2100'],
    ['a date after 2100', { date: '2101-01-01' }, 'Choose a date between 2000 and 2100'],
    ['a long note', { note: 'x'.repeat(201) }, 'Use at most 200 characters'],
  ])('rejects %s', (_name, override, message) => {
    expect(messages('USD', override)).toContain(message)
  })

  it('accepts the largest amount the server allows and rejects one minor unit more', () => {
    expect(messages('USD', { amount: '10000000000.00' })).toEqual([])
    expect(messages('USD', { amount: '10000000000.01' })).toContain('Amount is too large')
    expect(messages('JPY', { amount: '1000000000000' })).toEqual([])
    expect(messages('JPY', { amount: '1000000000001' })).toContain('Amount is too large')
  })

  it('accepts the smallest amount: one minor unit', () => {
    expect(messages('USD', { amount: '0.01' })).toEqual([])
    expect(messages('JPY', { amount: '1' })).toEqual([])
    expect(messages('BHD', { amount: '0.001' })).toEqual([])
  })

  it('accepts the first and last reportable dates', () => {
    expect(messages('USD', { date: '2000-01-01' })).toEqual([])
    expect(messages('USD', { date: '2100-12-31' })).toEqual([])
  })

  it('uses the currency to decide how many decimals are allowed', () => {
    expect(makeTransactionFormSchema('JPY').safeParse({ ...valid, amount: '500' }).success).toBe(
      true,
    )
    expect(makeTransactionFormSchema('JPY').safeParse({ ...valid, amount: '5.5' }).success).toBe(
      false,
    )
    expect(makeTransactionFormSchema('BHD').safeParse({ ...valid, amount: '1.234' }).success).toBe(
      true,
    )
  })

  it('never turns an ambiguous amount into a number', () => {
    expect(messages('BHD', { amount: '1,234' })).toContain('Enter a valid amount in BHD')
    expect(messages('USD', { amount: '12.345' })).toContain('Enter a valid amount in USD')
  })

  it('refuses every amount when the currency is not a valid code', () => {
    for (const currency of ['', 'us', 'USDX', '12$']) {
      expect(messages(currency, {})).toContain('Your profile currency is missing or invalid')
    }
  })
})

describe('isReportableDate', () => {
  it.each(['2000-01-01', '2026-09-15', '2024-02-29', '2100-12-31'])('accepts %s', (value) => {
    expect(isReportableDate(value)).toBe(true)
  })

  it.each([
    '',
    '20000-01-01',
    '02026-01-01',
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-1-1',
    '1999-12-31',
    '2101-01-01',
    'tomorrow',
  ])('rejects %s', (value) => {
    expect(isReportableDate(value)).toBe(false)
  })
})

describe('toTransactionInput', () => {
  it('converts the typed amount to integer minor units', () => {
    expect(toTransactionInput(valid, 'USD')).toEqual({
      kind: 'expense',
      amountMinor: 1250,
      categoryId: 'cat1',
      date: '2026-09-15',
      note: 'Lunch',
    })
    expect(toTransactionInput({ ...valid, amount: '500' }, 'JPY').amountMinor).toBe(500)
    expect(toTransactionInput({ ...valid, amount: '1.234' }, 'BHD').amountMinor).toBe(1234)
  })

  it('trims the note', () => {
    expect(toTransactionInput({ ...valid, note: '  hi  ' }, 'USD').note).toBe('hi')
  })
})

describe('toFormValues', () => {
  it('starts a new expense dated today with no category', () => {
    expect(toFormValues('USD', undefined, '2026-09-24')).toEqual({
      kind: 'expense',
      amount: '',
      categoryId: '',
      date: '2026-09-24',
      note: '',
    })
  })

  it("fills the form from an existing transaction in the currency's own format", () => {
    const transaction: Transaction = {
      id: '1',
      kind: 'income',
      amountMinor: 123456,
      currency: 'USD',
      categoryId: 'cat9',
      date: '2026-09-01',
      note: 'Pay',
    }

    expect(toFormValues('USD', transaction)).toEqual({
      kind: 'income',
      amount: '1234.56',
      categoryId: 'cat9',
      date: '2026-09-01',
      note: 'Pay',
    })
  })

  it.each([
    ['JPY', 500, '500'],
    ['BHD', 1234, '1.234'],
    ['USD', 5, '0.05'],
  ])('round-trips %s: %i minor units through the form and back', (currency, minor, text) => {
    const transaction: Transaction = {
      id: '1',
      kind: 'expense',
      amountMinor: minor,
      currency,
      categoryId: 'c',
      date: '2026-09-01',
      note: '',
    }

    const values = toFormValues(currency, transaction)

    expect(values.amount).toBe(text)
    expect(toTransactionInput(values, currency).amountMinor).toBe(minor)
  })

  it('never guesses the scale of an amount when the currency is not a valid code', () => {
    const transaction: Transaction = {
      id: '1',
      kind: 'expense',
      amountMinor: 1234,
      currency: 'BHD',
      categoryId: 'c',
      date: '2026-09-01',
      note: '',
    }

    expect(toFormValues('', transaction).amount).toBe('')
  })
})
