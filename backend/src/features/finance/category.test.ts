import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { DEFAULT_CATEGORIES } from './default-categories.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const list = (query = '', user = alice) =>
  request(app).get(`/api/categories${query}`).set(user.headers)
const create = (body: object, user = alice) =>
  request(app).post('/api/categories').set(user.headers).send(body)

describe('GET /api/categories', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/categories').expect(401)
  })

  it('creates the default set on first use and returns it', async () => {
    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(res.body.items[0]).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      name: expect.any(String),
      kind: expect.stringMatching(/^(income|expense)$/),
    })
    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('does not create the defaults twice, even when requests race', async () => {
    await Promise.all([list(), list(), list()])

    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('answers every racing first request with the complete default set', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => list()))

    for (const res of responses) {
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
    }
    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('races a first create against a first list: the same-named default is skipped, never doubled', async () => {
    const [created, listed] = await Promise.all([
      create({ name: 'salary', kind: 'income' }),
      list(),
    ])

    expect([201, 409]).toContain(created.status)
    expect(listed.status).toBe(200)
    expect(listed.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('fills in the defaults around a category the user created first, ignoring case', async () => {
    await create({ name: 'salary', kind: 'income' }).expect(201)

    const res = await list()

    expect(res.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(await Category.countDocuments({ userId: alice.id, name: 'Salary' })).toBe(0)
  })

  it('completes a default set that an interrupted first request left half written', async () => {
    await insertCategory(alice.id, { name: 'Groceries', kind: 'expense' })

    const res = await list()

    expect(res.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
  })

  it('does not bring the defaults back after the user has removed them all', async () => {
    const first = await list()
    for (const { id } of first.body.items) {
      await request(app).delete(`/api/categories/${id}`).set(alice.headers).expect(204)
    }

    const again = await list()

    expect(again.body.items).toEqual([])
  })

  it('gives each user their own default set', async () => {
    const bob = testUser()
    await Promise.all([list(), list('', bob)])

    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
    expect(await Category.countDocuments({ userId: bob.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('sorts by kind, then name, ignoring case', async () => {
    await create({ name: 'aardvark food', kind: 'expense' })
    await create({ name: 'Zebra', kind: 'expense' })

    const { body } = await list('?kind=expense')
    const names: string[] = body.items.map((c: { name: string }) => c.name)

    expect(names[0]).toBe('aardvark food')
    expect(names.at(-1)).toBe('Zebra')
  })

  it('filters by kind', async () => {
    const income = await list('?kind=income')
    const expense = await list('?kind=expense')

    expect(income.body.items.every((c: { kind: string }) => c.kind === 'income')).toBe(true)
    expect(expense.body.items.every((c: { kind: string }) => c.kind === 'expense')).toBe(true)
    expect(income.body.items.length + expense.body.items.length).toBe(DEFAULT_CATEGORIES.length)
  })

  it('rejects an unknown kind', async () => {
    await list('?kind=transfer').expect(400)
  })
})

describe('POST /api/categories', () => {
  it('creates a category', async () => {
    const res = await create({ name: '  Pets  ', kind: 'expense' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Pets', kind: 'expense' })
  })

  it('refuses a duplicate name of the same kind, ignoring case, but allows it for the other kind', async () => {
    await create({ name: 'Pets', kind: 'expense' }).expect(201)

    const duplicate = await create({ name: 'pets', kind: 'expense' })
    const otherKind = await create({ name: 'Pets', kind: 'income' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({ message: 'A category with that name already exists' })
    expect(otherKind.status).toBe(201)
  })

  it('treats an accented name as distinct from the plain one but folds case', async () => {
    await create({ name: 'Caf\u00e9', kind: 'expense' }).expect(201)

    await create({ name: 'Cafe', kind: 'expense' }).expect(201)
    await create({ name: 'CAF\u00c9', kind: 'expense' }).expect(409)
  })

  it('answers concurrent creates of the same name with one 201 and the rest 409', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        create({ name: i % 2 ? 'PETS' : 'pets', kind: 'expense' }),
      ),
    )

    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
  })

  it.each([
    ['a blank name', { name: '  ', kind: 'expense' }],
    ['a 41-character name', { name: 'x'.repeat(41), kind: 'expense' }],
    ['an unknown kind', { name: 'x', kind: 'transfer' }],
    ['no kind', { name: 'x' }],
  ])('rejects %s', async (_name, body) => {
    await create(body).expect(400)
  })

  it('keeps the same name separate between users', async () => {
    await create({ name: 'Pets', kind: 'expense' }).expect(201)

    await create({ name: 'Pets', kind: 'expense' }, testUser()).expect(201)
  })
})

describe('PATCH /api/categories/:id', () => {
  const rename = (id: string, name: string) =>
    request(app).patch(`/api/categories/${id}`).set(alice.headers).send({ name })

  it('renames a category', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })

    const res = await rename(body.id, 'Animals')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: body.id, name: 'Animals', kind: 'expense' })
  })

  it('refuses a name that another category of the same kind already has', async () => {
    await create({ name: 'Pets', kind: 'expense' })
    const { body } = await create({ name: 'Animals', kind: 'expense' })

    await rename(body.id, 'PETS').expect(409)
  })

  it('allows changing only the case of its own name', async () => {
    const { body } = await create({ name: 'pets', kind: 'expense' })

    const res = await rename(body.id, 'Pets')

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Pets')
  })

  it('allows a name that only the other kind has', async () => {
    await create({ name: 'Pets', kind: 'income' })
    const { body } = await create({ name: 'Animals', kind: 'expense' })

    await rename(body.id, 'pets').expect(200)
  })

  it('trims the new name and rejects a blank one', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })

    const res = await rename(body.id, '  Animals ')

    expect(res.body.name).toBe('Animals')
    await rename(body.id, '   ').expect(400)
  })

  it("does not rename another user's category", async () => {
    const bob = testUser()
    const { body } = await create({ name: 'Pets', kind: 'expense' }, bob)

    await rename(body.id, 'Animals').expect(404)

    expect(await Category.countDocuments({ _id: body.id, name: 'Pets' })).toBe(1)
  })

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    await rename('65f1c2a4b3d4e5f6a7b8c9d0', 'x').expect(404)
    await rename('nope', 'x').expect(400)
  })
})

describe('DELETE /api/categories/:id', () => {
  it('deletes an unused category', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })

    await request(app).delete(`/api/categories/${body.id}`).set(alice.headers).expect(204)

    expect(await Category.countDocuments({ _id: body.id })).toBe(0)
  })

  it('refuses to delete a category that transactions use, and says how many', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })
    await insertTransaction(alice.id, { categoryId: body.id })
    await insertTransaction(alice.id, { categoryId: body.id })

    const res = await request(app).delete(`/api/categories/${body.id}`).set(alice.headers)

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/2 transactions/)
    expect(await Category.countDocuments({ _id: body.id })).toBe(1)
  })

  it('counts only its own transactions and refuses with the singular wording for one', async () => {
    const bob = testUser()
    const { body } = await create({ name: 'Pets', kind: 'expense' })
    await insertTransaction(alice.id, { categoryId: body.id })
    await insertTransaction(bob.id, { categoryId: body.id })

    const res = await request(app).delete(`/api/categories/${body.id}`).set(alice.headers)

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/^1 transaction uses this category/)
  })

  it("does not delete another user's category", async () => {
    const bob = testUser()
    const { body } = await create({ name: 'Pets', kind: 'expense' }, bob)

    await request(app).delete(`/api/categories/${body.id}`).set(alice.headers).expect(404)

    expect(await Category.countDocuments({ _id: body.id })).toBe(1)
  })

  it('answers 400 for a malformed id', async () => {
    await request(app).delete('/api/categories/nope').set(alice.headers).expect(400)
  })

  it('answers 404 for an unknown category', async () => {
    await request(app)
      .delete('/api/categories/65f1c2a4b3d4e5f6a7b8c9d0')
      .set(alice.headers)
      .expect(404)
  })
})
