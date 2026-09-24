import { request, type Response } from '../../test/http.ts'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const list = (query = '') => request(app).get(`/api/tasks${query}`).set(alice.headers)
const titles = (res: Response) => res.body.items.map((t: { title: string }) => t.title)
const date = (value: string) => new Date(`${value}T00:00:00.000Z`)

describe('GET /api/tasks', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/tasks').expect(401)
  })

  it('returns an empty page for a user with no tasks', async () => {
    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
  })

  it('filters by status and orders by position', async () => {
    await insertTask(alice.id, { title: 'b', position: 2 })
    await insertTask(alice.id, { title: 'a', position: 1 })
    await insertTask(alice.id, { title: 'done', status: 'done' })

    const res = await list('?status=todo')

    expect(titles(res)).toEqual(['a', 'b'])
    expect(res.body.total).toBe(2)
  })

  it('filters by tag', async () => {
    await insertTask(alice.id, { title: 'home one', tags: ['home'] })
    await insertTask(alice.id, { title: 'work one', tags: ['work', 'urgent'] })

    expect(titles(await list('?tag=urgent'))).toEqual(['work one'])
    expect(titles(await list('?tag=nope'))).toEqual([])
  })

  it('searches titles case-insensitively', async () => {
    await insertTask(alice.id, { title: 'Buy Milk' })
    await insertTask(alice.id, { title: 'Call mum' })

    expect(titles(await list('?q=milk'))).toEqual(['Buy Milk'])
  })

  it.each(['a.b', '(', '[', '*', '\\', 'a|b', '$'])(
    'treats %j in the search text literally',
    async (q) => {
      await insertTask(alice.id, { title: 'a.b' })
      await insertTask(alice.id, { title: 'axb' })
      await insertTask(alice.id, { title: '(x) [y] *z* \\ $ a|b' })

      const res = await list(`?q=${encodeURIComponent(q)}`)

      expect(res.status).toBe(200)
      const expected = q === 'a.b' ? ['a.b'] : ['(x) [y] *z* \\ $ a|b']
      expect(titles(res).sort()).toEqual(expected.sort())
    },
  )

  it.each(['%00', 'a%00b', '%01', '%1f', '%7f', 'x%0Ay'])(
    'rejects control characters in the search text with a 400 (%s)',
    async (q) => {
      await insertTask(alice.id, { title: 'Buy Milk' })

      const res = await list(`?q=${q}`)

      expect(res.status).toBe(400)
      expect(res.body.errors).toEqual([{ path: 'q', message: 'Invalid search text' }])
    },
  )

  it('does not crash on a NUL byte in the tag filter', async () => {
    await insertTask(alice.id, { title: 'Buy Milk', tags: ['home'] })

    const res = await list('?tag=%00')

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
  })

  it('lists open tasks due on or before a date, soonest first', async () => {
    await insertTask(alice.id, { title: 'late', dueDate: date('2026-10-05') })
    await insertTask(alice.id, { title: 'soon', dueDate: date('2026-09-25') })
    await insertTask(alice.id, { title: 'done soon', dueDate: date('2026-09-24'), status: 'done' })
    await insertTask(alice.id, { title: 'no date' })
    await insertTask(alice.id, { title: 'too far', dueDate: date('2026-12-01') })

    const res = await list('?open=true&dueBefore=2026-10-05&sort=dueDate')

    expect(titles(res)).toEqual(['soon', 'late'])
  })

  it('puts the newest card first when positions are equal, and pages through them stably', async () => {
    await insertTask(alice.id, { title: 'older', position: 5 })
    await insertTask(alice.id, { title: 'newer', position: 5 })
    await insertTask(alice.id, { title: 'newest', position: 5 })

    expect(titles(await list('?status=todo'))).toEqual(['newest', 'newer', 'older'])
    expect(titles(await list('?limit=1&page=1'))).toEqual(['newest'])
    expect(titles(await list('?limit=1&page=2'))).toEqual(['newer'])
    expect(titles(await list('?limit=1&page=3'))).toEqual(['older'])
    expect(titles(await list('?sort=dueDate'))).toEqual(['newest', 'newer', 'older'])
  })

  it('open=true with status=done matches nothing', async () => {
    await insertTask(alice.id, { status: 'done' })

    expect((await list('?open=true&status=done')).body.total).toBe(0)
  })

  it('paginates and reports the total', async () => {
    for (let position = 1; position <= 5; position += 1) {
      await insertTask(alice.id, { title: `t${position}`, position })
    }

    const page2 = await list('?limit=2&page=2')
    const page3 = await list('?limit=2&page=3')

    expect(titles(page2)).toEqual(['t3', 't4'])
    expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 5 })
    expect(titles(page3)).toEqual(['t5'])
  })

  it.each([
    '?page=0',
    '?limit=201',
    '?status=archived',
    '?dueBefore=2026-02-30',
    '?open=maybe',
    '?tag=a&tag=b',
  ])('rejects %s with 400', async (query) => {
    await list(query).expect(400)
  })
})

describe('GET /api/tasks/tags', () => {
  it("returns the user's distinct tags, sorted", async () => {
    await insertTask(alice.id, { tags: ['work', 'home'] })
    await insertTask(alice.id, { tags: ['home', 'urgent'] })

    const res = await request(app).get('/api/tasks/tags').set(alice.headers)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tags: ['home', 'urgent', 'work'] })
  })
})
