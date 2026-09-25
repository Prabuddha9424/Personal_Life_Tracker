import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { CategorySeed } from './category-seed.model.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { deleteFinanceForUser, exportFinanceForUser, hasFinanceDataForUser } from './index.ts'
import { Transaction } from './transaction.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const INVALID_IDS = ['', 'not-an-id', '12', 'a'.repeat(23), 'a'.repeat(25)]

describe('finance public API', () => {
  it('reports whether a user has transactions; categories alone do not count', async () => {
    const alice = testUser()
    const bob = testUser()
    await insertCategory(alice.id)
    await insertTransaction(bob.id)

    expect(await hasFinanceDataForUser(alice.id)).toBe(false)
    expect(await hasFinanceDataForUser(bob.id)).toBe(true)
  })

  it("exports only the user's own categories and transactions", async () => {
    const alice = testUser()
    const bob = testUser()
    const groceries = await insertCategory(alice.id, { name: 'Groceries' })
    await insertTransaction(alice.id, {
      categoryId: groceries._id,
      date: '2026-09-02',
      note: 'later',
    })
    await insertTransaction(alice.id, {
      categoryId: groceries._id,
      date: '2026-09-01',
      note: 'earlier',
    })
    await insertTransaction(bob.id, { note: 'not yours' })

    const exported = await exportFinanceForUser(alice.id)

    expect(exported.categories.map((c) => c.name)).toEqual(['Groceries'])
    expect(exported.transactions.map((t) => t.note)).toEqual(['earlier', 'later'])
    expect(exported.transactions[0]).toMatchObject({
      date: '2026-09-01',
      kind: 'expense',
      currency: 'USD',
    })
  })

  it('exports a transaction that has no category with an empty categoryId', async () => {
    const alice = testUser()
    await Transaction.collection.insertOne({
      userId: new Types.ObjectId(alice.id),
      kind: 'expense',
      amountMinor: 900,
      currency: 'USD',
      date: new Date('2026-09-02T00:00:00.000Z'),
      note: 'orphan',
    })

    const exported = await exportFinanceForUser(alice.id)

    expect(exported.transactions).toEqual([
      expect.objectContaining({ note: 'orphan', categoryId: '' }),
    ])
  })

  it('exports empty lists for a user without finance data', async () => {
    await insertTransaction(testUser().id)

    expect(await exportFinanceForUser(testUser().id)).toEqual({ categories: [], transactions: [] })
  })

  it("deletes all of one user's finance data and leaves everyone else's", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTransaction(alice.id)
    await insertTransaction(bob.id)

    await deleteFinanceForUser(alice.id)

    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Category.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(1)
    expect(await Category.countDocuments({ userId: bob.id })).toBe(1)
  })

  describe.each(INVALID_IDS)('with the invalid user id %j', (invalid) => {
    it('refuses to export, delete or look up, and touches nothing', async () => {
      const bob = testUser()
      await insertTransaction(bob.id)

      await expect(exportFinanceForUser(invalid)).rejects.toThrow('valid user id')
      await expect(deleteFinanceForUser(invalid)).rejects.toThrow('valid user id')
      await expect(hasFinanceDataForUser(invalid)).rejects.toThrow('valid user id')

      expect(await Transaction.countDocuments()).toBe(1)
      expect(await Category.countDocuments()).toBe(1)
    })
  })

  it('leaves everything alone when the user id belongs to nobody', async () => {
    const bob = testUser()
    await insertTransaction(bob.id)
    const stranger = new Types.ObjectId().toString()

    await deleteFinanceForUser(stranger)

    expect(await exportFinanceForUser(stranger)).toEqual({ categories: [], transactions: [] })
    expect(await hasFinanceDataForUser(stranger)).toBe(false)
    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(1)
    expect(await Category.countDocuments({ userId: bob.id })).toBe(1)
  })

  it("removes the user's seed marker too, and only theirs", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTransaction(alice.id)
    await insertTransaction(bob.id)
    await CategorySeed.create([{ userId: alice.id }, { userId: bob.id }])

    await deleteFinanceForUser(alice.id)

    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Category.countDocuments({ userId: alice.id })).toBe(0)
    expect(await CategorySeed.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(1)
    expect(await Category.countDocuments({ userId: bob.id })).toBe(1)
    expect(await CategorySeed.countDocuments({ userId: bob.id })).toBe(1)
  })
})
