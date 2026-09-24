import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task } from './task.model.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
let aliceTaskId: string
let aliceSecondId: string

beforeEach(async () => {
  const first = await insertTask(alice.id, {
    title: 'alice secret',
    tags: ['private'],
    position: 0,
  })
  const second = await insertTask(alice.id, { title: 'alice second', position: 1024 })
  aliceTaskId = first._id.toString()
  aliceSecondId = second._id.toString()
})

const asBob = {
  get: (url: string) => request(app).get(url).set(bob.headers),
  patch: (url: string, body: object) => request(app).patch(url).set(bob.headers).send(body),
  delete: (url: string) => request(app).delete(url).set(bob.headers),
  post: (url: string, body: object) => request(app).post(url).set(bob.headers).send(body),
}

describe("another user's tasks look like they do not exist", () => {
  it('cannot be read, changed, deleted or moved by id', async () => {
    await asBob.get(`/api/tasks/${aliceTaskId}`).expect(404)
    await asBob.patch(`/api/tasks/${aliceTaskId}`, { title: 'hacked' }).expect(404)
    await asBob.post(`/api/tasks/${aliceTaskId}/move`, { status: 'done' }).expect(404)
    await asBob.delete(`/api/tasks/${aliceTaskId}`).expect(404)

    const stored = await Task.findById(aliceTaskId)
    expect(stored).toMatchObject({ title: 'alice secret', status: 'todo' })
  })

  it('answers exactly like a task that never existed', async () => {
    const missing = '65f1c2a4b3d4e5f6a7b8c9d0'

    const theirs = await asBob.get(`/api/tasks/${aliceTaskId}`)
    const nothing = await asBob.get(`/api/tasks/${missing}`)

    expect(theirs.status).toBe(nothing.status)
    expect(theirs.body).toEqual(nothing.body)
  })

  it('never shows up in lists, searches, tag filters or the tag list', async () => {
    const all = await asBob.get('/api/tasks')
    const search = await asBob.get('/api/tasks?q=secret')
    const byTag = await asBob.get('/api/tasks?tag=private')
    const tags = await asBob.get('/api/tasks/tags')

    expect(all.body.total).toBe(0)
    expect(search.body.total).toBe(0)
    expect(byTag.body.total).toBe(0)
    expect(tags.body).toEqual({ tags: [] })
  })

  it("cannot be used as a neighbour in the other user's board", async () => {
    const mine = await insertTask(bob.id, { title: 'bob task' })

    const res = await asBob.post(`/api/tasks/${mine._id.toString()}/move`, {
      status: 'todo',
      afterId: aliceTaskId,
      beforeId: aliceSecondId,
    })

    expect(res.status).toBe(409)
    expect((await Task.findById(mine._id))?.position).toBe(0)
  })

  it('cannot be used as a single neighbour either', async () => {
    const mine = await insertTask(bob.id, { title: 'bob task' })

    await asBob
      .post(`/api/tasks/${mine._id.toString()}/move`, { status: 'todo', afterId: aliceTaskId })
      .expect(409)
    await asBob
      .post(`/api/tasks/${mine._id.toString()}/move`, { status: 'todo', beforeId: aliceTaskId })
      .expect(409)
  })

  it('cannot be created for someone else by sending their user id', async () => {
    const res = await asBob.post('/api/tasks', { title: 'planted', userId: alice.id })

    expect((await Task.findById(res.body.id))?.userId.toString()).toBe(bob.id)
    expect(await Task.countDocuments({ userId: alice.id })).toBe(2)
  })

  it('keeps counts and pagination per user', async () => {
    await insertTask(bob.id, { title: 'bob only' })

    const bobs = await asBob.get('/api/tasks')
    const alices = await request(app).get('/api/tasks').set(alice.headers)

    expect(bobs.body.total).toBe(1)
    expect(alices.body.total).toBe(2)
  })
})
