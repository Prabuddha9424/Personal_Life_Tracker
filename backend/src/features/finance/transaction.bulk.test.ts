import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertCategory } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
const logged = vi.hoisted(() => ({ lines: [] as string[] }))

vi.mock('../../shared/logger/logger.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/logger/logger.ts')>()
  return {
    ...actual,
    logger: pino(
      { ...actual.loggerOptions, transport: undefined, level: 'info' },
      {
        write: (line: string) => {
          logged.lines.push(line)
        },
      },
    ),
  }
})
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
  logged.lines.length = 0
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
    ['rows that are not an array', 'nope'],
  ])('rejects %s with 400', async (_name, rows) => {
    const res = await bulk(rows)

    expect(res.status).toBe(400)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('rejects 501 otherwise valid rows because of the count alone', async () => {
    const { row } = await setup()

    const res = await bulk(Array.from({ length: 501 }, (_, i) => row({ note: `n${i}` })))

    expect(res.status).toBe(400)
    expect(res.body.errors).toEqual([
      expect.objectContaining({ path: 'rows', message: expect.stringContaining('500') }),
    ])
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('rejects a fractional amount on an otherwise valid row with a real category', async () => {
    const { row } = await setup()

    const res = await bulk([row(), row({ amountMinor: 1.5 })])

    expect(res.status).toBe(400)
    expect(res.body.errors).toEqual([expect.objectContaining({ path: 'rows.1.amountMinor' })])
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

  it('accepts a category id sent in upper case', async () => {
    const { food, row } = await setup()

    const res = await bulk([row({ categoryId: food._id.toString().toUpperCase() })])

    expect(res.status).toBe(201)
    expect(await Transaction.countDocuments({ userId: alice.id, categoryId: food._id })).toBe(1)
  })

  it('still surfaces the original error, and logs the failure, when the cleanup fails too', async () => {
    const { row } = await setup()
    const realInsertMany = Transaction.insertMany.bind(Transaction)
    vi.spyOn(Transaction, 'insertMany').mockImplementationOnce((async (docs: unknown[]) => {
      await realInsertMany(docs.slice(0, 2) as never)
      throw new Error('connection lost')
    }) as never)
    vi.spyOn(Transaction, 'deleteMany').mockRejectedValueOnce(new Error('cleanup refused'))

    const res = await bulk([row({ note: 'SECRET-NOTE' }), row(), row()])

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ message: 'connection lost' })
    const entries = logged.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    const cleanup = entries.filter((entry) => String(entry.msg).includes('cleaned up'))
    expect(cleanup).toHaveLength(1)
    expect(cleanup[0]).toMatchObject({ level: 50, rows: 3 })
    expect(logged.lines.join('')).not.toContain('SECRET-NOTE')
  })
})
