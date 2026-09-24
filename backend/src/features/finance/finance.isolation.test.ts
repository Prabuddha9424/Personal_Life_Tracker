import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request, type Response } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { CategorySeed } from './category-seed.model.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

vi.mock(import('../auth/index.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: 'USD',
  }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
const carol = testUser()

let aliceCategory: string
let aliceUnusedCategory: string
let aliceTransaction: string
let bobCategory: string
let bobIncomeCategory: string
let bobTransaction: string

const as = (user: { headers: { Authorization: string } }) => ({
  get: (url: string) => request(app).get(url).set(user.headers),
  post: (url: string, body: object) => request(app).post(url).set(user.headers).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(user.headers).send(body),
  delete: (url: string) => request(app).delete(url).set(user.headers),
})
const asAlice = as(alice)
const asBob = as(bob)
const asCarol = as(carol)

/** Every stored document that belongs to alice, exactly as MongoDB holds it. */
async function aliceRows() {
  const owner = new Types.ObjectId(alice.id)
  const sorted = { sort: { _id: 1 } } as const
  return {
    categories: await Category.collection.find({ userId: owner }, sorted).toArray(),
    transactions: await Transaction.collection.find({ userId: owner }, sorted).toArray(),
    seeds: await CategorySeed.collection.find({ userId: owner }, sorted).toArray(),
  }
}

beforeEach(async () => {
  // Reading alice's categories creates her default set and her seed marker.
  await asAlice.get('/api/categories').expect(200)
  const used = await insertCategory(alice.id, { kind: 'expense', name: 'Alice private' })
  const unused = await insertCategory(alice.id, { kind: 'expense', name: 'Alice unused' })
  const tx = await insertTransaction(alice.id, { categoryId: used._id, note: 'alice secret' })
  await insertTransaction(alice.id, {
    categoryId: used._id,
    note: 'alice second',
    amountMinor: 555,
  })
  aliceCategory = used._id.toString()
  aliceUnusedCategory = unused._id.toString()
  aliceTransaction = tx._id.toString()

  const own = await insertCategory(bob.id, { kind: 'expense', name: 'Bob own' })
  const ownIncome = await insertCategory(bob.id, { kind: 'income', name: 'Bob income' })
  const ownTx = await insertTransaction(bob.id, { categoryId: own._id, note: 'bob own' })
  bobCategory = own._id.toString()
  bobIncomeCategory = ownIncome._id.toString()
  bobTransaction = ownTx._id.toString()
})

const newTransaction = (categoryId: string) => ({
  kind: 'expense',
  amountMinor: 100,
  categoryId,
  date: '2026-09-01',
})

/**
 * Every verb that takes an id, or references one, that another user could try to reach. `target`
 * picks the alice-owned id to aim at; the same request with an id that never existed is the control.
 */
const idCases: {
  name: string
  status: number
  target: () => string
  send: (id: string) => PromiseLike<Response>
}[] = [
  {
    name: 'PATCH a transaction',
    status: 404,
    target: () => aliceTransaction,
    send: (id) => asBob.patch(`/api/transactions/${id}`, { note: 'hacked', amountMinor: 1 }),
  },
  {
    name: 'PATCH a transaction into a category and kind',
    status: 404,
    target: () => aliceTransaction,
    send: (id) =>
      asBob.patch(`/api/transactions/${id}`, { kind: 'income', categoryId: bobIncomeCategory }),
  },
  {
    name: 'DELETE a transaction',
    status: 404,
    target: () => aliceTransaction,
    send: (id) => asBob.delete(`/api/transactions/${id}`),
  },
  {
    name: 'PATCH a category',
    status: 404,
    target: () => aliceCategory,
    send: (id) => asBob.patch(`/api/categories/${id}`, { name: 'hacked' }),
  },
  {
    name: 'DELETE a category that has transactions',
    status: 404,
    target: () => aliceCategory,
    send: (id) => asBob.delete(`/api/categories/${id}`),
  },
  {
    name: 'DELETE a category that has none',
    status: 404,
    target: () => aliceUnusedCategory,
    send: (id) => asBob.delete(`/api/categories/${id}`),
  },
  {
    name: 'POST a transaction into a category',
    status: 400,
    target: () => aliceCategory,
    send: (id) => asBob.post('/api/transactions', newTransaction(id)),
  },
  {
    name: "PATCH bob's own transaction into a category",
    status: 400,
    target: () => aliceCategory,
    send: (id) => asBob.patch(`/api/transactions/${bobTransaction}`, { categoryId: id }),
  },
  {
    name: 'POST bulk rows into a category',
    status: 400,
    target: () => aliceCategory,
    send: (id) => asBob.post('/api/transactions/bulk', { rows: [newTransaction(id)] }),
  },
  {
    name: "POST bulk rows mixing bob's own category with the id",
    status: 400,
    target: () => aliceCategory,
    send: (id) =>
      asBob.post('/api/transactions/bulk', {
        rows: [newTransaction(bobCategory), newTransaction(id)],
      }),
  },
  {
    name: 'list transactions filtered by category',
    status: 200,
    target: () => aliceCategory,
    send: (id) => asBob.get(`/api/transactions?categoryId=${id}`),
  },
]

describe("another user's finance data looks like it does not exist", () => {
  it.each(idCases)(
    '$name answers a foreign id exactly like one that never existed, and changes nothing',
    async ({ status, target, send }) => {
      const before = await aliceRows()

      const theirs = await send(target())
      const nothing = await send(new Types.ObjectId().toString())

      expect(theirs.status).toBe(status)
      expect(theirs.status).toBe(nothing.status)
      expect(theirs.text).toBe(nothing.text)
      expect(await aliceRows()).toEqual(before)
    },
  )

  it("does not tell bob that alice's category is in use", async () => {
    const res = await asBob.delete(`/api/categories/${aliceCategory}`)

    expect(res.status).toBe(404)
    expect(res.text).not.toMatch(/transactions? use/)
  })

  it('never lets a bulk import through when one row points at a foreign category', async () => {
    const before = await aliceRows()
    const bobsBefore = await Transaction.countDocuments({ userId: bob.id })

    await asBob
      .post('/api/transactions/bulk', {
        rows: [newTransaction(bobCategory), newTransaction(aliceCategory)],
      })
      .expect(400)

    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(bobsBefore)
    expect(await aliceRows()).toEqual(before)
  })

  it('lets bob reuse a category name alice already has, without touching hers', async () => {
    const before = await aliceRows()

    const created = await asBob.post('/api/categories', { name: 'Alice private', kind: 'expense' })
    const renamed = await asBob.patch(`/api/categories/${bobCategory}`, { name: 'Alice unused' })

    expect(created.status).toBe(201)
    expect(renamed.status).toBe(200)
    expect(await aliceRows()).toEqual(before)
  })

  it('never lists them, in lists, filters, pages or category lists', async () => {
    const before = await aliceRows()

    const transactions = await asBob.get('/api/transactions')
    const byCategory = await asBob.get(`/api/transactions?categoryId=${aliceCategory}`)
    const byKind = await asBob.get('/api/transactions?kind=expense&limit=200&from=2000-01-01')
    const categories = await asBob.get('/api/categories')
    const expenseCategories = await asBob.get('/api/categories?kind=expense')

    expect(transactions.body.items.map((t: { note: string }) => t.note)).toEqual(['bob own'])
    expect(transactions.body.total).toBe(1)
    expect(byCategory.body.total).toBe(0)
    expect(byKind.body.items.map((t: { note: string }) => t.note)).toEqual(['bob own'])
    for (const res of [categories, expenseCategories]) {
      expect(res.text).not.toContain('Alice private')
      expect(res.text).not.toContain(aliceCategory)
    }
    expect(await aliceRows()).toEqual(before)
  })

  it('cannot be created for someone else by sending their user id', async () => {
    const before = await aliceRows()

    const created = await asBob.post('/api/transactions', {
      ...newTransaction(bobCategory),
      userId: alice.id,
    })
    const bulk = await asBob.post('/api/transactions/bulk', {
      rows: [{ ...newTransaction(bobCategory), userId: alice.id }],
    })
    const category = await asBob.post('/api/categories', {
      name: 'Planted',
      kind: 'expense',
      userId: alice.id,
    })

    expect(created.status).toBe(201)
    expect(bulk.status).toBe(201)
    expect(category.status).toBe(201)
    expect((await Transaction.findById(created.body.id))?.userId.toString()).toBe(bob.id)
    expect((await Category.findById(category.body.id))?.userId.toString()).toBe(bob.id)
    expect(await Transaction.countDocuments({ userId: bob.id, note: '' })).toBe(2)
    expect(await aliceRows()).toEqual(before)
  })
})

describe("another user's finance data never shows up in reports", () => {
  const reports = [
    '/api/finance/summary?month=2026-09',
    '/api/finance/by-category?month=2026-09',
    '/api/finance/monthly?to=2026-09',
    '/api/finance/trend?to=2026-09',
  ]

  it.each(reports)(
    '%s answers a user without data exactly like any other such user',
    async (path) => {
      const before = await aliceRows()

      const bobs = await asBob.get(path.replace('2026-09', '2026-01'))
      const carols = await asCarol.get(path.replace('2026-09', '2026-01'))
      const bobsSeptember = await asBob.get(path)

      expect(bobs.status).toBe(200)
      expect(bobs.text).toBe(carols.text)
      for (const res of [bobs, bobsSeptember]) {
        expect(res.text).not.toContain('Alice')
        expect(res.text).not.toContain(aliceCategory)
      }
      expect(await aliceRows()).toEqual(before)
    },
  )

  it("counts only bob's own rows, in every report", async () => {
    await Transaction.deleteMany({ userId: bob.id })
    await insertTransaction(bob.id, { amountMinor: 250, date: '2026-09-03' })
    await insertTransaction(bob.id, { amountMinor: 900, kind: 'income', date: '2026-08-03' })

    const summary = await asBob.get('/api/finance/summary?month=2026-09')
    const byCategory = await asBob.get('/api/finance/by-category?month=2026-09')
    const monthly = await asBob.get('/api/finance/monthly?to=2026-09')
    const trend = await asBob.get('/api/finance/trend?to=2026-09')

    expect(summary.body).toMatchObject({ incomeMinor: 0, expenseMinor: 250, netMinor: -250 })
    expect(byCategory.body.items.map((i: { totalMinor: number }) => i.totalMinor)).toEqual([250])
    expect(monthly.body.items.at(-1)).toMatchObject({ month: '2026-09', expenseMinor: 250 })
    expect(monthly.body.items.at(-2)).toMatchObject({ month: '2026-08', incomeMinor: 900 })
    expect(trend.body).toMatchObject({ openingMinor: 0 })
    expect(trend.body.items.at(-1)).toEqual({ month: '2026-09', balanceMinor: 650 })
  })
})
