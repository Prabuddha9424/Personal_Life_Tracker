import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { DEFAULT_CATEGORIES } from './default-categories.ts'
import { toCategoryDto, toTransactionDto } from './finance.dto.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()

describe('Category', () => {
  it('rejects a name that differs only by case for the same user and kind', async () => {
    await insertCategory(alice.id, { name: 'Food', kind: 'expense' })
    await expect(insertCategory(alice.id, { name: 'food', kind: 'expense' })).rejects.toThrow(
      /duplicate key/,
    )
  })

  // What the { locale: 'en', strength: 2 } collation actually folds, checked against the real index.
  it.each([
    ['folds the dotted capital I to i plus a combining dot', '\u0130', 'i\u0307', true],
    ['folds a precomposed accent to its decomposed form', 'Caf\u00e9', 'Cafe\u0301', true],
    ['folds a base letter with its accent to another case', '\u00e9', 'E\u0301', true],
    ['folds a fullwidth letter to its ASCII form', '\uff21', 'A', true],
    [
      'keeps Caf\u00e9 and Cafe distinct (accents differ at strength 2)',
      'Caf\u00e9',
      'Cafe',
      false,
    ],
    ['keeps the sharp s and ss distinct (no expansion fold)', '\u00df', 'ss', false],
  ])('%s', async (_behaviour, first, second, isDuplicate) => {
    await insertCategory(alice.id, { name: first })
    const insertSecond = insertCategory(alice.id, { name: second })
    if (isDuplicate) await expect(insertSecond).rejects.toThrow(/duplicate key/)
    else await expect(insertSecond).resolves.toBeDefined()
  })

  it('allows the same name for another kind or another user', async () => {
    await insertCategory(alice.id, { name: 'Other', kind: 'expense' })
    await expect(insertCategory(alice.id, { name: 'Other', kind: 'income' })).resolves.toBeDefined()
    await expect(insertCategory(bob.id, { name: 'Other', kind: 'expense' })).resolves.toBeDefined()
  })

  it('has unique default names per kind', () => {
    const keys = DEFAULT_CATEGORIES.map((c) => `${c.kind}:${c.name.toLowerCase()}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('maps to a DTO', async () => {
    const category = await insertCategory(alice.id, { name: 'Food' })
    expect(toCategoryDto(category)).toEqual({
      id: category._id.toString(),
      name: 'Food',
      kind: 'expense',
    })
  })
})

describe('Transaction', () => {
  it('stores the date at UTC midnight and maps to a DTO with a YYYY-MM-DD date', async () => {
    const tx = await insertTransaction(alice.id, { amountMinor: 1250, date: '2026-09-15' })
    expect(tx.date.toISOString()).toBe('2026-09-15T00:00:00.000Z')
    expect(toTransactionDto(tx)).toEqual({
      id: tx._id.toString(),
      kind: 'expense',
      amountMinor: 1250,
      currency: 'USD',
      categoryId: tx.categoryId.toString(),
      date: '2026-09-15',
      note: '',
    })
  })

  it('creates a category of the same kind when none is given', async () => {
    const tx = await insertTransaction(alice.id, { kind: 'income' })
    const category = await Category.findOne({ _id: tx.categoryId, userId: alice.id }).lean()
    expect(category?.kind).toBe('income')
  })

  it.each([0, -1, 10.5, 1_000_000_000_001])('rejects amountMinor %s', async (amountMinor) => {
    await expect(insertTransaction(alice.id, { amountMinor })).rejects.toThrow()
  })

  it('upper-cases the currency and requires 3 letters', async () => {
    expect((await insertTransaction(alice.id, { currency: 'eur' })).currency).toBe('EUR')
    await expect(insertTransaction(alice.id, { currency: 'EU' })).rejects.toThrow()
  })

  it.each(['E1R', 'U$D', '€UR', 'EU '])('rejects the non-letter currency %j', async (currency) => {
    await expect(insertTransaction(alice.id, { currency })).rejects.toThrow(/currency/)
  })

  it('requires a category', async () => {
    await expect(
      Transaction.create({
        userId: new Types.ObjectId(alice.id),
        kind: 'expense',
        amountMinor: 100,
        currency: 'USD',
        date: new Date(),
      }),
    ).rejects.toThrow(/categoryId/)
  })
})
