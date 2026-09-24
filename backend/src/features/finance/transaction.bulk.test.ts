import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertCategory } from './finance.test-helpers.ts'
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
afterEach(() => {
  profiles.clear()
  vi.restoreAllMocks()
})
afterAll(stopTestDb)

const alice = testUser()
const bulk = (rows: unknown, user = alice) =>
  request(app).post('/api/transactions/bulk').set(user.headers).send({ rows })

async function setup() {
  const food = await insertCategory(alice.id, { kind: 'expense', name: 'Food' })
  const pay = await insertCategory(alice.id, { kind: 'income', name: 'Pay' })
  const row = (overrides: object = {}) => ({
    kind: 'expense',
    amountMinor: 500,
    categoryId: food._id.toString(),
    date: '2026-09-01',
    note: 'x',
    ...overrides,
  })
  return { food, pay, row }
}

describe('POST /api/transactions/bulk', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/transactions/bulk').send({ rows: [] }).expect(401)
  })

  it("creates every row, in the user's currency, and reports the count", async () => {
    const { pay, row } = await setup()
    profiles.set(alice.id, 'EUR')

    const res = await bulk([
      row(),
      row({ note: 'y', amountMinor: 700, currency: 'JPY' }),
      row({ kind: 'income', categoryId: pay._id.toString(), amountMinor: 90000 }),
    ])

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ created: 3 })
    const stored = await Transaction.find({ userId: alice.id })
    expect(stored).toHaveLength(3)
    expect(stored.every((tx) => tx.currency === 'EUR')).toBe(true)
    expect(stored.map((tx) => tx.amountMinor).sort((a, b) => a - b)).toEqual([500, 700, 90000])
    expect(stored[0]?.date.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('stores nothing when any row has an unknown category, and names the row', async () => {
    const { row } = await setup()

    const res = await bulk([row(), row(), row({ categoryId: '65f1c2a4b3d4e5f6a7b8c9d0' })])

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Row 3: unknown category' })
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it("rejects another user's category and a category of the wrong kind", async () => {
    const { pay, row } = await setup()
    const bobsCategory = await insertCategory(testUser().id, { kind: 'expense' })

    const foreign = await bulk([row({ categoryId: bobsCategory._id.toString() })])
    const foreignLate = await bulk([row(), row(), row({ categoryId: bobsCategory._id.toString() })])
    const wrongKind = await bulk([row(), row({ categoryId: pay._id.toString() })])

    expect(foreign.status).toBe(400)
    expect(foreign.body).toEqual({ message: 'Row 1: unknown category' })
    expect(foreignLate.body).toEqual({ message: 'Row 3: unknown category' })
    expect(wrongKind.body).toEqual({ message: 'Row 2: that is an income category' })
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it.each([
    ['no rows', []],
    ['more than 500 rows', Array.from({ length: 501 }, () => ({}))],
    [
      'a row with a fractional amount',
      [
        {
          kind: 'expense',
          amountMinor: 1.5,
          categoryId: '65f1c2a4b3d4e5f6a7b8c9d0',
          date: '2026-09-01',
        },
      ],
    ],
    ['rows that are not an array', 'nope'],
  ])('rejects %s with 400', async (_name, rows) => {
    const res = await bulk(rows)

    expect(res.status).toBe(400)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('accepts exactly 500 rows', async () => {
    const { row } = await setup()

    const res = await bulk(Array.from({ length: 500 }, (_, i) => row({ note: `n${i}` })))

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ created: 500 })
    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(500)
  })

  it('ignores a userId inside a row', async () => {
    const { row } = await setup()
    const bob = testUser()

    await bulk([row({ userId: bob.id })]).expect(201)

    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(0)
    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(1)
  })

  it('leaves nothing behind when the insert fails part way', async () => {
    const { row } = await setup()
    const realInsertMany = Transaction.insertMany.bind(Transaction)
    vi.spyOn(Transaction, 'insertMany').mockImplementationOnce((async (docs: unknown[]) => {
      await realInsertMany(docs.slice(0, 2) as never)
      throw new Error('connection lost')
    }) as never)

    const res = await bulk([row(), row(), row()])

    expect(res.status).toBe(500)
    expect(await Transaction.countDocuments()).toBe(0)
  })
})
