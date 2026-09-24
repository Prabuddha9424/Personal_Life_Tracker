import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
vi.mock(import('../auth/index.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: profiles.get(id) ?? 'USD',
  }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
const get = (url: string, user = alice) => request(app).get(url).set(user.headers)

interface MonthItem {
  month: string
}

const monthsOf = (items: MonthItem[]) => items.map((item) => item.month)

/** Alice's data (and bob's, in the same months, which must never leak in). */
async function seed() {
  const groceries = await insertCategory(alice.id, { kind: 'expense', name: 'Groceries' })
  const transport = await insertCategory(alice.id, { kind: 'expense', name: 'Transport' })
  const salary = await insertCategory(alice.id, { kind: 'income', name: 'Salary' })
  const tx = (
    date: string,
    kind: 'income' | 'expense',
    amountMinor: number,
    categoryId: Types.ObjectId,
  ) => insertTransaction(alice.id, { date, kind, amountMinor, categoryId })

  await tx('2026-09-01', 'expense', 5000, groceries._id)
  await tx('2026-09-30', 'expense', 2500, groceries._id)
  await tx('2026-09-15', 'expense', 1200, transport._id)
  await tx('2026-09-25', 'income', 300000, salary._id)
  await tx('2026-08-31', 'expense', 4000, groceries._id)
  await tx('2026-08-25', 'income', 300000, salary._id)
  await tx('2026-10-01', 'expense', 999, groceries._id)
  await tx('2025-01-10', 'income', 10000, salary._id)

  await insertTransaction(bob.id, { date: '2026-09-10', kind: 'income', amountMinor: 111111 })
  await insertTransaction(bob.id, { date: '2026-09-11', kind: 'expense', amountMinor: 77777 })
  return { groceries, transport, salary }
}

beforeEach(() => {
  profiles.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/finance/summary', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/finance/summary').expect(401)
  })

  it("totals the user's month and nothing else", async () => {
    await seed()

    const res = await get('/api/finance/summary?month=2026-09')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      month: '2026-09',
      currency: 'USD',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })
  })

  it('puts the 30th and the 1st in different months', async () => {
    await seed()

    const august = await get('/api/finance/summary?month=2026-08')
    const october = await get('/api/finance/summary?month=2026-10')

    expect(august.body).toMatchObject({ incomeMinor: 300000, expenseMinor: 4000 })
    expect(october.body).toMatchObject({ incomeMinor: 0, expenseMinor: 999, netMinor: -999 })
  })

  it('splits months at exact UTC instants, whatever the process time zone is', async () => {
    const category = await insertCategory(alice.id)
    const at = (iso: string, amountMinor: number) =>
      Transaction.create({
        userId: new Types.ObjectId(alice.id),
        kind: 'expense',
        amountMinor,
        currency: 'USD',
        categoryId: category._id,
        date: new Date(iso),
      })
    await at('2026-02-28T23:59:59.999Z', 1)
    await at('2026-03-01T00:00:00.000Z', 20)
    await at('2026-03-31T23:59:59.999Z', 300)
    await at('2026-04-01T00:00:00.000Z', 4000)

    const february = await get('/api/finance/summary?month=2026-02')
    const march = await get('/api/finance/summary?month=2026-03')
    const april = await get('/api/finance/summary?month=2026-04')
    const monthly = await get('/api/finance/monthly?months=6&to=2026-04')

    expect(february.body.expenseMinor).toBe(1)
    expect(march.body.expenseMinor).toBe(320)
    expect(april.body.expenseMinor).toBe(4000)
    expect(
      monthly.body.items.map((item: { month: string; expenseMinor: number }) => [
        item.month,
        item.expenseMinor,
      ]),
    ).toEqual([
      ['2025-11', 0],
      ['2025-12', 0],
      ['2026-01', 0],
      ['2026-02', 1],
      ['2026-03', 320],
      ['2026-04', 4000],
    ])
  })

  it('defaults to the current UTC month, not the local one', async () => {
    vi.useFakeTimers({ now: new Date('2026-03-01T00:30:00.000Z'), toFake: ['Date'] })

    const res = await get('/api/finance/summary')

    expect(res.body.month).toBe('2026-03')
  })

  it('returns zeros for an empty month and defaults to the current month', async () => {
    const empty = await get('/api/finance/summary?month=2020-01')
    const current = await get('/api/finance/summary')

    expect(empty.body).toMatchObject({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
    expect(current.body.month).toMatch(/^\d{4}-\d{2}$/)
  })

  it("reports the user's currency", async () => {
    profiles.set(alice.id, 'JPY')

    const res = await get('/api/finance/summary?month=2026-09')

    expect(res.body.currency).toBe('JPY')
  })

  it('keeps two users with data in the same month apart', async () => {
    await seed()

    const alices = await get('/api/finance/summary?month=2026-09')
    const bobs = await get('/api/finance/summary?month=2026-09', bob)

    expect(alices.body).toMatchObject({ incomeMinor: 300000, expenseMinor: 8700 })
    expect(bobs.body).toMatchObject({ incomeMinor: 111111, expenseMinor: 77777, netMinor: 33334 })
  })

  it('sums very large amounts exactly', async () => {
    const category = await insertCategory(alice.id)
    const otherCategory = await insertCategory(alice.id, { kind: 'income' })
    await Transaction.insertMany(
      Array.from({ length: 1000 }, () => ({
        userId: new Types.ObjectId(alice.id),
        kind: 'expense',
        amountMinor: 999_999_999_999,
        currency: 'USD',
        categoryId: category._id,
        date: new Date('2026-09-10T00:00:00.000Z'),
      })),
    )
    await insertTransaction(alice.id, {
      kind: 'income',
      amountMinor: 1_000_000_000_000,
      categoryId: otherCategory._id,
    })

    const res = await get('/api/finance/summary?month=2026-09')

    expect(res.body.expenseMinor).toBe(999_999_999_999_000)
    expect(res.body.incomeMinor).toBe(1_000_000_000_000)
    expect(res.body.netMinor).toBe(1_000_000_000_000 - 999_999_999_999_000)
    expect(Number.isSafeInteger(res.body.expenseMinor)).toBe(true)
  })

  it.each([
    '?month=2026-13',
    '?month=2026-9',
    '?month=2026-09-01',
    '?month=september',
    '?month=1999-12',
    '?month=2101-01',
  ])('rejects %s', async (query) => {
    await get(`/api/finance/summary${query}`).expect(400)
  })
})

describe('GET /api/finance/by-category', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/finance/by-category').expect(401)
  })

  it('groups expenses by category, largest first, with names', async () => {
    const { groceries, transport } = await seed()

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body).toEqual({
      month: '2026-09',
      currency: 'USD',
      items: [
        { categoryId: groceries._id.toString(), name: 'Groceries', totalMinor: 7500 },
        { categoryId: transport._id.toString(), name: 'Transport', totalMinor: 1200 },
      ],
    })
  })

  it('leaves income out', async () => {
    await seed()

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body.items.map((item: { name: string }) => item.name)).not.toContain('Salary')
  })

  it('still counts a transaction whose category was deleted', async () => {
    const { groceries } = await seed()
    await Category.deleteOne({ _id: groceries._id })

    const res = await get('/api/finance/by-category?month=2026-09')
    const summary = await get('/api/finance/summary?month=2026-09')

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toEqual({
      categoryId: groceries._id.toString(),
      name: 'Deleted category',
      totalMinor: 7500,
    })
    expect(summary.body.expenseMinor).toBe(8700)
  })

  it("never shows another user's category name", async () => {
    const bobsCategory = await insertCategory(bob.id, { kind: 'expense', name: 'Secret hobby' })
    await insertTransaction(alice.id, {
      kind: 'expense',
      amountMinor: 4200,
      categoryId: bobsCategory._id,
    })

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body.items).toEqual([
      { categoryId: bobsCategory._id.toString(), name: 'Deleted category', totalMinor: 4200 },
    ])
  })

  it("never includes another user's spending", async () => {
    await seed()

    const alices = await get('/api/finance/by-category?month=2026-09')
    const bobs = await get('/api/finance/by-category?month=2026-09', bob)

    expect(alices.body.items).toHaveLength(2)
    expect(bobs.body.items).toHaveLength(1)
    expect(bobs.body.items[0].totalMinor).toBe(77777)
  })

  it('returns no items for an empty month and rejects a bad month', async () => {
    const empty = await get('/api/finance/by-category?month=2020-01')

    expect(empty.body).toEqual({ month: '2020-01', currency: 'USD', items: [] })
    await get('/api/finance/by-category?month=2026-13').expect(400)
  })
})

describe('GET /api/finance/monthly', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/finance/monthly').expect(401)
  })

  it('returns six months, oldest first, filling empty months with zeros', async () => {
    await seed()

    const res = await get('/api/finance/monthly?months=6&to=2026-09')

    expect(res.body.currency).toBe('USD')
    expect(monthsOf(res.body.items)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
    expect(res.body.items[0]).toEqual({
      month: '2026-04',
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
    })
    expect(res.body.items[4]).toEqual({
      month: '2026-08',
      incomeMinor: 300000,
      expenseMinor: 4000,
      netMinor: 296000,
    })
    expect(res.body.items[5]).toEqual({
      month: '2026-09',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })
  })

  it('spans the year boundary', async () => {
    const res = await get('/api/finance/monthly?months=6&to=2026-02')

    expect(monthsOf(res.body.items)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('keeps December and January apart', async () => {
    const category = await insertCategory(alice.id)
    await insertTransaction(alice.id, {
      date: '2025-12-31',
      amountMinor: 7,
      categoryId: category._id,
    })
    await insertTransaction(alice.id, {
      date: '2026-01-01',
      amountMinor: 90,
      categoryId: category._id,
    })

    const res = await get('/api/finance/monthly?months=6&to=2026-02')

    expect(res.body.items[3]).toMatchObject({ month: '2025-12', expenseMinor: 7 })
    expect(res.body.items[4]).toMatchObject({ month: '2026-01', expenseMinor: 90 })
  })

  it('supports twelve months and defaults to six', async () => {
    const twelve = await get('/api/finance/monthly?months=12&to=2026-09')
    const defaults = await get('/api/finance/monthly?to=2026-09')

    expect(twelve.body.items).toHaveLength(12)
    expect(defaults.body.items).toHaveLength(6)
  })

  it('never returns more than twelve months', async () => {
    const res = await get('/api/finance/monthly?months=12&to=2000-01')

    expect(res.body.items).toHaveLength(12)
    expect(res.body.items[0].month).toBe('1999-02')
  })

  it.each([
    '?months=7',
    '?months=0',
    '?months=13',
    '?months=120',
    '?months=-6',
    '?months=6.5',
    '?to=2026-13',
    '?to=1999-12',
    '?to=2101-01',
  ])('rejects %s', async (query) => {
    await get(`/api/finance/monthly${query}`).expect(400)
  })

  it("does not include another user's months", async () => {
    await seed()

    const alices = await get('/api/finance/monthly?months=6&to=2026-09')
    const bobs = await get('/api/finance/monthly?months=6&to=2026-09', bob)

    expect(alices.body.items[5]).toMatchObject({ incomeMinor: 300000, expenseMinor: 8700 })
    expect(bobs.body.items[5]).toMatchObject({ incomeMinor: 111111, expenseMinor: 77777 })
    expect(bobs.body.items[4]).toMatchObject({ incomeMinor: 0, expenseMinor: 0 })
  })
})

describe('GET /api/finance/trend', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/finance/trend').expect(401)
  })

  it("starts from the balance before the window and adds each month's net", async () => {
    await seed()

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body).toEqual({
      currency: 'USD',
      openingMinor: 10000,
      items: [
        { month: '2026-04', balanceMinor: 10000 },
        { month: '2026-05', balanceMinor: 10000 },
        { month: '2026-06', balanceMinor: 10000 },
        { month: '2026-07', balanceMinor: 10000 },
        { month: '2026-08', balanceMinor: 306000 },
        { month: '2026-09', balanceMinor: 597300 },
      ],
    })
  })

  it('counts a transaction on the first day of the window in the window, not the opening balance', async () => {
    await insertTransaction(alice.id, { date: '2026-03-31', kind: 'income', amountMinor: 100 })
    await insertTransaction(alice.id, { date: '2026-04-01', kind: 'income', amountMinor: 20 })

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.openingMinor).toBe(100)
    expect(res.body.items[0]).toEqual({ month: '2026-04', balanceMinor: 120 })
  })

  it('leaves out transactions after the window', async () => {
    await insertTransaction(alice.id, { date: '2026-10-01', kind: 'income', amountMinor: 500 })

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.items[5].balanceMinor).toBe(0)
  })

  it('has a zero opening balance and flat line for a user with no data', async () => {
    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.openingMinor).toBe(0)
    expect(res.body.items).toHaveLength(6)
    expect(res.body.items.every((item: { balanceMinor: number }) => item.balanceMinor === 0)).toBe(
      true,
    )
  })

  it('can go negative when spending exceeds income', async () => {
    await insertTransaction(alice.id, { date: '2026-09-02', kind: 'expense', amountMinor: 250 })

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.items[5].balanceMinor).toBe(-250)
  })

  it("does not count another user's opening balance", async () => {
    await insertTransaction(bob.id, { date: '2020-01-01', kind: 'income', amountMinor: 555 })
    await insertTransaction(alice.id, { date: '2020-01-01', kind: 'income', amountMinor: 44 })

    const alices = await get('/api/finance/trend?months=6&to=2026-09')
    const bobs = await get('/api/finance/trend?months=6&to=2026-09', bob)

    expect(alices.body.openingMinor).toBe(44)
    expect(bobs.body.openingMinor).toBe(555)
  })

  it('rejects an unbounded window', async () => {
    await get('/api/finance/trend?months=1000').expect(400)
    await get('/api/finance/trend?to=2101-01').expect(400)
  })
})
