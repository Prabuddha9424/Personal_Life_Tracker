import { request } from '../../test/http.ts'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task } from './task.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const create = (body: object, user = alice) =>
  request(app).post('/api/tasks').set(user.headers).send(body)
const list = (query = '', user = alice) => request(app).get(`/api/tasks${query}`).set(user.headers)

describe('POST /api/tasks', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/tasks').send({ title: 'x' }).expect(401)
  })

  it('creates a task with sensible defaults', async () => {
    const res = await create({ title: '  Buy milk  ' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      title: 'Buy milk',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      tags: [],
    })
    expect(res.body.createdAt).toEqual(expect.any(String))
  })

  it('stores the fields it was given, including the due date as a calendar date', async () => {
    const res = await create({
      title: 'Pay rent',
      description: 'Before the 1st',
      priority: 'high',
      dueDate: '2026-10-01',
      status: 'in_progress',
    })

    expect(res.body).toMatchObject({
      description: 'Before the 1st',
      priority: 'high',
      dueDate: '2026-10-01',
      status: 'in_progress',
    })
    expect((await Task.findById(res.body.id))?.dueDate?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    )
  })

  it('normalises tags: trimmed, lower-cased and de-duplicated', async () => {
    const res = await create({ title: 'x', tags: [' Home ', 'HOME', 'work'] })

    expect(res.body.tags).toEqual(['home', 'work'])
  })

  it('puts a new task at the top of its column', async () => {
    const first = await create({ title: 'first' })
    const second = await create({ title: 'second' })
    const otherColumn = await create({ title: 'elsewhere', status: 'done' })

    const todo = await list('?status=todo')

    expect(todo.body.items.map((t: { title: string }) => t.title)).toEqual(['second', 'first'])
    expect(second.body.position).toBeLessThan(first.body.position)
    expect(otherColumn.body.position).toBe(0)
  })

  it.each([
    ['an empty title', { title: '   ' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a missing title', {}],
    ['an unknown priority', { title: 'x', priority: 'urgent' }],
    ['an unknown status', { title: 'x', status: 'archived' }],
    ['an impossible date', { title: 'x', dueDate: '2026-02-30' }],
    ['a date with a time', { title: 'x', dueDate: '2026-02-03T10:00:00Z' }],
    ['11 tags', { title: 'x', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['a 31-character tag', { title: 'x', tags: ['t'.repeat(31)] }],
    ['an empty tag', { title: 'x', tags: ['  '] }],
  ])('rejects %s with 400 and stores nothing', async (_name, body) => {
    const res = await create(body)

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Validation failed')
    expect(await Task.countDocuments()).toBe(0)
  })

  it('ignores a userId sent by the client', async () => {
    const bob = testUser()

    const res = await create({ title: 'mine', userId: alice.id }, bob)

    expect((await Task.findById(res.body.id))?.userId.toString()).toBe(bob.id)
  })
})

describe('GET /api/tasks/:id', () => {
  it('returns the task', async () => {
    const created = await create({ title: 'x' })

    const res = await request(app).get(`/api/tasks/${created.body.id}`).set(alice.headers)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(created.body.id)
  })

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    await request(app).get('/api/tasks/65f1c2a4b3d4e5f6a7b8c9d0').set(alice.headers).expect(404)
    await request(app).get('/api/tasks/not-an-id').set(alice.headers).expect(400)
  })
})

describe('PATCH /api/tasks/:id', () => {
  const patch = (id: string, body: object) =>
    request(app).patch(`/api/tasks/${id}`).set(alice.headers).send(body)

  it('updates only the fields it is given', async () => {
    const created = await create({ title: 'old', description: 'keep me', priority: 'low' })

    const res = await patch(created.body.id, { title: 'new', priority: 'high' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'new', priority: 'high', description: 'keep me' })
  })

  it('sets and clears the due date, and normalises tags', async () => {
    const created = await create({ title: 'x', dueDate: '2026-10-01' })

    const cleared = await patch(created.body.id, { dueDate: null, tags: ['B', 'a', 'b'] })

    expect(cleared.body.dueDate).toBeNull()
    expect(cleared.body.tags).toEqual(['b', 'a'])
    expect((await patch(created.body.id, { dueDate: '2027-01-31' })).body.dueDate).toBe(
      '2027-01-31',
    )
  })

  it('cannot change status or position (only the move endpoint can)', async () => {
    const created = await create({ title: 'x' })

    const res = await patch(created.body.id, { title: 'y', status: 'done', position: 999 })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('todo')
    expect(res.body.position).toBe(created.body.position)
  })

  it('rejects an empty update, a blank title and an unknown id', async () => {
    const created = await create({ title: 'x' })

    await patch(created.body.id, {}).expect(400)
    await patch(created.body.id, { title: ' ' }).expect(400)
    await patch('65f1c2a4b3d4e5f6a7b8c9d0', { title: 'y' }).expect(404)
  })
})

describe('DELETE /api/tasks/:id', () => {
  it('deletes the task with 204, then answers 404', async () => {
    const created = await create({ title: 'x' })

    await request(app).delete(`/api/tasks/${created.body.id}`).set(alice.headers).expect(204)

    await request(app).delete(`/api/tasks/${created.body.id}`).set(alice.headers).expect(404)
    expect(await Task.countDocuments()).toBe(0)
  })
})

describe('tenant isolation', () => {
  it("answers 404 for another user's task on read, update and delete, and leaves it untouched", async () => {
    const bob = testUser()
    const mine = await create({ title: 'private', tags: ['secret'] })
    const url = `/api/tasks/${mine.body.id}`

    await request(app).get(url).set(bob.headers).expect(404)
    await request(app).patch(url).set(bob.headers).send({ title: 'hacked' }).expect(404)
    await request(app).delete(url).set(bob.headers).expect(404)

    const stored = await Task.findById(mine.body.id)
    expect(stored?.title).toBe('private')
    expect((await list('', bob)).body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
    expect((await request(app).get('/api/tasks/tags').set(bob.headers)).body).toEqual({ tags: [] })
  })

  it("does not place a new task relative to another user's column", async () => {
    const bob = testUser()
    await create({ title: 'bob first' }, bob)

    const res = await create({ title: 'alice first' })

    expect(res.body.position).toBe(0)
  })
})
