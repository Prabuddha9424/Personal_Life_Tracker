import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
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
const create = (body: object, user = alice) =>
  request(app).post('/api/transactions').set(user.headers).send(body)
const list = (query = '', user = alice) =>
  request(app).get(`/api/transactions${query}`).set(user.headers)

async function body(overrides: object = {}, user = alice) {
  const category = await insertCategory(user.id, { kind: 'expense' })
  return {
    kind: 'expense',
    amountMinor: 1250,
    categoryId: category._id.toString(),
    date: '2026-09-15',
    note: 'Lunch',
    ...overrides,
  }
}

const notesOf = (res: { body: { items: { note: string }[] } }) => res.body.items.map((t) => t.note)

describe('POST /api/transactions', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/transactions').send({}).expect(401)
  })

  it("creates a transaction in the user's currency", async () => {
    const res = await create(await body())

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      kind: 'expense',
      amountMinor: 1250,
      currency: 'USD',
      categoryId: expect.any(String),
      date: '2026-09-15',
      note: 'Lunch',
    })
  })

  it('stores integer minor units for currencies with no or three decimals', async () => {
    const yen = testUser()
    const dinar = testUser()
    profiles.set(yen.id, 'JPY')
    profiles.set(dinar.id, 'BHD')

    const jpy = await create(await body({ amountMinor: 500 }, yen), yen)
    const bhd = await create(await body({ amountMinor: 1234 }, dinar), dinar)

    expect(jpy.body).toMatchObject({ amountMinor: 500, currency: 'JPY' })
    expect(bhd.body).toMatchObject({ amountMinor: 1234, currency: 'BHD' })
    expect((await Transaction.findById(jpy.body.id))?.amountMinor).toBe(500)
    expect((await Transaction.findById(bhd.body.id))?.amountMinor).toBe(1234)
    const listed = await list('', dinar)
    expect(listed.body.items[0]).toMatchObject({ amountMinor: 1234, currency: 'BHD' })
  })

  it('defaults the note to empty and stores the date at UTC midnight', async () => {
    const res = await create(await body({ note: undefined }))

    expect(res.body.note).toBe('')
    expect((await Transaction.findById(res.body.id))?.date.toISOString()).toBe(
      '2026-09-15T00:00:00.000Z',
    )
  })

  it.each([
    ['a zero amount', { amountMinor: 0 }],
    ['a negative amount', { amountMinor: -5 }],
    ['a fractional amount', { amountMinor: 12.5 }],
    ['an amount over the limit', { amountMinor: 1_000_000_000_001 }],
    ['an amount sent as a string', { amountMinor: '1250' }],
    ['an impossible date', { date: '2026-02-30' }],
    ['a date with a time', { date: '2026-02-03T10:00:00Z' }],
    ['a long note', { note: 'x'.repeat(201) }],
    ['an unknown kind', { kind: 'transfer' }],
    ['a malformed category id', { categoryId: 'nope' }],
  ])('rejects %s with 400', async (_name, override) => {
    const res = await create(await body(override))

    expect(res.status).toBe(400)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it("rejects another user's category and one that does not exist, with the same answer", async () => {
    const bob = testUser()
    const bobsCategory = await insertCategory(bob.id, { kind: 'expense' })

    const foreign = await create(await body({ categoryId: bobsCategory._id.toString() }))
    const missing = await create(await body({ categoryId: '65f1c2a4b3d4e5f6a7b8c9d0' }))

    expect(foreign.status).toBe(400)
    expect(foreign.body).toEqual({ message: 'Unknown category' })
    expect(missing.body).toEqual(foreign.body)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('rejects a category of the other kind', async () => {
    const income = await insertCategory(alice.id, { kind: 'income' })

    const res = await create(await body({ kind: 'expense', categoryId: income._id.toString() }))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/income category/)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('ignores a client-supplied userId and currency', async () => {
    const bob = testUser()

    const res = await create({ ...(await body()), userId: bob.id, currency: 'EUR' })

    const stored = await Transaction.findById(res.body.id)
    expect(stored?.userId.toString()).toBe(alice.id)
    expect(stored?.currency).toBe('USD')
    expect(res.body.currency).toBe('USD')
  })
})

describe('GET /api/transactions', () => {
  it('returns an empty page for a user with no transactions', async () => {
    const res = await list()

    expect(res.body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
  })

  it('lists newest first', async () => {
    await insertTransaction(alice.id, { date: '2026-09-01', note: 'old' })
    await insertTransaction(alice.id, { date: '2026-09-20', note: 'new' })
    await insertTransaction(alice.id, { date: '2026-09-10', note: 'middle' })

    expect(notesOf(await list())).toEqual(['new', 'middle', 'old'])
  })

  it('breaks date ties by newest insert first', async () => {
    await insertTransaction(alice.id, { date: '2026-09-10', note: 'first' })
    await insertTransaction(alice.id, { date: '2026-09-10', note: 'second' })
    await insertTransaction(alice.id, { date: '2026-09-10', note: 'third' })

    expect(notesOf(await list())).toEqual(['third', 'second', 'first'])
    expect(notesOf(await list('?limit=1&page=2'))).toEqual(['second'])
  })

  it('filters by date range (inclusive), kind and category', async () => {
    const groceries = await insertCategory(alice.id, { kind: 'expense', name: 'Groceries' })
    await insertTransaction(alice.id, { date: '2026-09-01', note: 'a', categoryId: groceries._id })
    await insertTransaction(alice.id, { date: '2026-09-15', note: 'b' })
    await insertTransaction(alice.id, { date: '2026-09-30', note: 'c', kind: 'income' })

    const notes = async (query: string) => notesOf(await list(query)).sort()

    expect(await notes('?from=2026-09-15&to=2026-09-30')).toEqual(['b', 'c'])
    expect(await notes('?from=2026-09-16')).toEqual(['c'])
    expect(await notes('?to=2026-09-01')).toEqual(['a'])
    expect(await notes('?from=2026-09-01&to=2026-09-01')).toEqual(['a'])
    expect(await notes('?kind=income')).toEqual(['c'])
    expect(await notes(`?categoryId=${groceries._id.toString()}`)).toEqual(['a'])
  })

  it("never returns or counts another user's transactions", async () => {
    const bob = testUser()
    await insertTransaction(alice.id, { note: 'mine' })
    await insertTransaction(bob.id, { note: 'theirs' })

    const res = await list()

    expect(notesOf(res)).toEqual(['mine'])
    expect(res.body.total).toBe(1)
  })

  it('paginates and reports the total', async () => {
    for (let day = 1; day <= 5; day += 1) {
      await insertTransaction(alice.id, { date: `2026-09-0${day}`, note: `d${day}` })
    }

    const res = await list('?limit=2&page=2')

    expect(notesOf(res)).toEqual(['d3', 'd2'])
    expect(res.body).toMatchObject({ page: 2, limit: 2, total: 5 })
  })

  it.each(['?from=2026-09-30&to=2026-09-01', '?limit=201', '?kind=transfer', '?from=nope'])(
    'rejects %s',
    async (query) => {
      await list(query).expect(400)
    },
  )
})

describe('PATCH /api/transactions/:id', () => {
  const patch = (id: string, payload: object, user = alice) =>
    request(app).patch(`/api/transactions/${id}`).set(user.headers).send(payload)

  it('updates only the given fields', async () => {
    const tx = await insertTransaction(alice.id, { note: 'keep', amountMinor: 100 })

    const res = await patch(tx._id.toString(), { amountMinor: 999, date: '2026-10-01' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ amountMinor: 999, date: '2026-10-01', note: 'keep' })
    const stored = await Transaction.findById(tx._id)
    expect(stored?.amountMinor).toBe(999)
    expect(stored?.date.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('checks the category against the kind when either changes', async () => {
    const tx = await insertTransaction(alice.id, { kind: 'expense' })
    const income = await insertCategory(alice.id, { kind: 'income' })

    await patch(tx._id.toString(), { categoryId: income._id.toString() }).expect(400)
    await patch(tx._id.toString(), { kind: 'income' }).expect(400)
    expect((await Transaction.findById(tx._id))?.kind).toBe('expense')
    await patch(tx._id.toString(), { kind: 'income', categoryId: income._id.toString() }).expect(
      200,
    )
    expect((await Transaction.findById(tx._id))?.kind).toBe('income')
  })

  it("rejects another user's category as unknown", async () => {
    const tx = await insertTransaction(alice.id)
    const bobsCategory = await insertCategory(testUser().id, { kind: 'expense' })

    const res = await patch(tx._id.toString(), { categoryId: bobsCategory._id.toString() })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Unknown category' })
  })

  it('rejects an empty update and answers 404 for an unknown id', async () => {
    const tx = await insertTransaction(alice.id)

    await patch(tx._id.toString(), {}).expect(400)
    await patch('65f1c2a4b3d4e5f6a7b8c9d0', { note: 'x' }).expect(404)
  })

  it('answers a foreign transaction exactly like a missing one and leaves it untouched', async () => {
    const bob = testUser()
    const bobsTx = await insertTransaction(bob.id, { note: 'bobs', amountMinor: 100 })

    const foreign = await patch(bobsTx._id.toString(), { note: 'hacked', amountMinor: 1 })
    const missing = await patch('65f1c2a4b3d4e5f6a7b8c9d0', { note: 'hacked', amountMinor: 1 })

    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual(missing.body)
    const stored = await Transaction.findById(bobsTx._id)
    expect(stored).toMatchObject({ note: 'bobs', amountMinor: 100 })
  })

  it('does not change the currency or owner, even when the client sends them', async () => {
    const tx = await insertTransaction(alice.id, { currency: 'EUR' })

    const res = await patch(tx._id.toString(), {
      note: 'changed',
      currency: 'USD',
      userId: testUser().id,
    })

    expect(res.body.currency).toBe('EUR')
    const stored = await Transaction.findById(tx._id)
    expect(stored?.currency).toBe('EUR')
    expect(stored?.userId.toString()).toBe(alice.id)
  })

  it('rejects an invalid amount without changing the stored value', async () => {
    const tx = await insertTransaction(alice.id, { amountMinor: 100 })

    await patch(tx._id.toString(), { amountMinor: 1.5 }).expect(400)

    expect((await Transaction.findById(tx._id))?.amountMinor).toBe(100)
  })
})

describe('DELETE /api/transactions/:id', () => {
  it('deletes with 204 and then answers 404', async () => {
    const tx = await insertTransaction(alice.id)

    await request(app)
      .delete(`/api/transactions/${tx._id.toString()}`)
      .set(alice.headers)
      .expect(204)

    await request(app)
      .delete(`/api/transactions/${tx._id.toString()}`)
      .set(alice.headers)
      .expect(404)
  })

  it('answers a foreign transaction exactly like a missing one and keeps it', async () => {
    const bobsTx = await insertTransaction(testUser().id)

    const foreign = await request(app)
      .delete(`/api/transactions/${bobsTx._id.toString()}`)
      .set(alice.headers)
    const missing = await request(app)
      .delete('/api/transactions/65f1c2a4b3d4e5f6a7b8c9d0')
      .set(alice.headers)

    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual(missing.body)
    expect(await Transaction.countDocuments()).toBe(1)
  })
})
