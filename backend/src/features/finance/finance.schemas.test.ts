import { describe, expect, it } from 'vitest'
import {
  bulkTransactionsSchema,
  categoryBodySchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  monthQuerySchema,
  rangeQuerySchema,
  renameCategorySchema,
  updateTransactionSchema,
} from './finance.schemas.ts'

const validTransaction = {
  kind: 'expense',
  amountMinor: 1250,
  categoryId: 'a'.repeat(24),
  date: '2026-09-15',
}

describe('category schemas', () => {
  it('trims the name and rejects an empty or over-long one', () => {
    expect(categoryBodySchema.parse({ name: '  Food ', kind: 'expense' }).name).toBe('Food')
    expect(categoryBodySchema.safeParse({ name: '   ', kind: 'expense' }).success).toBe(false)
    expect(categoryBodySchema.safeParse({ name: 'x'.repeat(41), kind: 'expense' }).success).toBe(
      false,
    )
    expect(renameCategorySchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    expect(categoryBodySchema.safeParse({ name: 'Food', kind: 'transfer' }).success).toBe(false)
  })
})

describe('createTransactionSchema', () => {
  it('defaults the note to an empty string', () => {
    expect(createTransactionSchema.parse(validTransaction).note).toBe('')
  })

  it.each([0, -5, 12.5, 1_000_000_000_001, Number.NaN])('rejects amountMinor %s', (amountMinor) => {
    expect(createTransactionSchema.safeParse({ ...validTransaction, amountMinor }).success).toBe(
      false,
    )
  })

  it.each([1, 1_000_000_000_000])('accepts amountMinor %s', (amountMinor) => {
    expect(createTransactionSchema.safeParse({ ...validTransaction, amountMinor }).success).toBe(
      true,
    )
  })

  it('rejects a numeric string amount and an invalid date or id', () => {
    expect(
      createTransactionSchema.safeParse({ ...validTransaction, amountMinor: '10' }).success,
    ).toBe(false)
    expect(
      createTransactionSchema.safeParse({ ...validTransaction, date: '2026-02-30' }).success,
    ).toBe(false)
    expect(
      createTransactionSchema.safeParse({ ...validTransaction, categoryId: 'nope' }).success,
    ).toBe(false)
  })

  it('strips unknown keys such as userId and currency', () => {
    const parsed = createTransactionSchema.parse({
      ...validTransaction,
      userId: 'b'.repeat(24),
      currency: 'JPY',
    })
    expect(parsed).not.toHaveProperty('userId')
    expect(parsed).not.toHaveProperty('currency')
  })

  it('rejects an infinite amount', () => {
    expect(
      createTransactionSchema.safeParse({
        ...validTransaction,
        amountMinor: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false)
  })

  it.each(['0001-01-01', '1999-12-31', '2101-01-01', '9999-12-31'])(
    'rejects the date %s, outside 2000-2100',
    (date) => {
      expect(createTransactionSchema.safeParse({ ...validTransaction, date }).success).toBe(false)
    },
  )

  it.each(['2000-01-01', '2100-12-31'])('accepts the boundary date %s', (date) => {
    expect(createTransactionSchema.safeParse({ ...validTransaction, date }).success).toBe(true)
  })

  it('rejects a note over 200 characters', () => {
    expect(
      createTransactionSchema.safeParse({ ...validTransaction, note: 'n'.repeat(201) }).success,
    ).toBe(false)
  })
})

describe('updateTransactionSchema', () => {
  it('accepts a partial update and rejects an empty one', () => {
    expect(updateTransactionSchema.parse({ amountMinor: 5 })).toEqual({ amountMinor: 5 })
    expect(updateTransactionSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a partial update that changes the kind', () => {
    expect(updateTransactionSchema.parse({ kind: 'income' })).toEqual({ kind: 'income' })
    expect(updateTransactionSchema.safeParse({ kind: 'transfer' }).success).toBe(false)
  })

  it('applies the same date bounds to an update', () => {
    expect(updateTransactionSchema.safeParse({ date: '9999-12-31' }).success).toBe(false)
  })
})

describe('bulkTransactionsSchema', () => {
  it('requires between 1 and 500 rows', () => {
    expect(bulkTransactionsSchema.safeParse({ rows: [] }).success).toBe(false)
    expect(bulkTransactionsSchema.safeParse({ rows: [validTransaction] }).success).toBe(true)
    const tooMany = Array.from({ length: 501 }, () => validTransaction)
    expect(bulkTransactionsSchema.safeParse({ rows: tooMany }).success).toBe(false)
  })
})

describe('listTransactionsQuerySchema', () => {
  it('applies pagination defaults and coerces strings', () => {
    expect(listTransactionsQuerySchema.parse({})).toMatchObject({ page: 1, limit: 50 })
    expect(listTransactionsQuerySchema.parse({ page: '2', limit: '10' })).toMatchObject({
      page: 2,
      limit: 10,
    })
  })

  it.each(['from', 'to'])('rejects a %s date outside 2000-2100', (key) => {
    expect(listTransactionsQuerySchema.safeParse({ [key]: '0001-01-01' }).success).toBe(false)
    expect(listTransactionsQuerySchema.safeParse({ [key]: '9999-12-31' }).success).toBe(false)
    expect(listTransactionsQuerySchema.safeParse({ [key]: '2026-09-01' }).success).toBe(true)
  })

  it('rejects from after to but accepts equal dates', () => {
    expect(
      listTransactionsQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-01' }).success,
    ).toBe(false)
    expect(
      listTransactionsQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-10' }).success,
    ).toBe(true)
  })
})

describe('monthQuerySchema and rangeQuerySchema', () => {
  it('defaults the month to the current month and validates the format', () => {
    expect(monthQuerySchema.parse({}).month).toMatch(/^\d{4}-\d{2}$/)
    expect(monthQuerySchema.parse({ month: '2026-09' }).month).toBe('2026-09')
    expect(monthQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false)
  })

  it('defaults months to 6, transforms to a number and only allows 6 or 12', () => {
    expect(rangeQuerySchema.parse({}).months).toBe(6)
    expect(rangeQuerySchema.parse({ months: '12', to: '2026-09' })).toEqual({
      months: 12,
      to: '2026-09',
    })
    expect(rangeQuerySchema.safeParse({ months: '3' }).success).toBe(false)
  })
})
