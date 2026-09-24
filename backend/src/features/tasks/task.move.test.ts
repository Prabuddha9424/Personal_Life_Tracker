import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Task, type TaskRecord } from './task.model.ts'
import { POSITION_STEP } from './task.ordering.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()

const idOf = (task: TaskRecord) => task._id.toString()

const move = (id: string, body: object, user = alice) =>
  request(app).post(`/api/tasks/${id}/move`).set(user.headers).send(body)

/** Titles of a column in board order. */
async function column(status: string): Promise<string[]> {
  const res = await request(app).get(`/api/tasks?status=${status}`).set(alice.headers)
  return res.body.items.map((t: { title: string }) => t.title)
}

/** Three To Do cards A, B, C at positions 0, 1024, 2048. */
async function seedABC() {
  const a = await insertTask(alice.id, { title: 'A', position: 0 })
  const b = await insertTask(alice.id, { title: 'B', position: POSITION_STEP })
  const c = await insertTask(alice.id, { title: 'C', position: 2 * POSITION_STEP })
  return { a, b, c }
}

describe('POST /api/tasks/:id/move', () => {
  it('requires authentication', async () => {
    await request(app)
      .post('/api/tasks/65f1c2a4b3d4e5f6a7b8c9d0/move')
      .send({ status: 'done' })
      .expect(401)
  })

  it('moves a card into an empty column', async () => {
    const { a } = await seedABC()

    const res = await move(idOf(a), { status: 'in_progress' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'A', status: 'in_progress', position: 0 })
    expect(await column('todo')).toEqual(['B', 'C'])
    expect(await column('in_progress')).toEqual(['A'])
  })

  it('reorders within a column: between two cards', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) }).expect(200)

    expect(await column('todo')).toEqual(['A', 'C', 'B'])
  })

  it('reorders within a column: to the top and to the bottom', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', beforeId: idOf(a) }).expect(200)
    expect(await column('todo')).toEqual(['C', 'A', 'B'])

    await move(idOf(c), { status: 'todo', afterId: idOf(b) }).expect(200)
    expect(await column('todo')).toEqual(['A', 'B', 'C'])
  })

  it('moves a card to another column at a chosen place', async () => {
    const { a } = await seedABC()
    const x = await insertTask(alice.id, { title: 'X', status: 'done', position: 0 })
    const y = await insertTask(alice.id, { title: 'Y', status: 'done', position: POSITION_STEP })

    await move(idOf(a), { status: 'done', afterId: idOf(x), beforeId: idOf(y) }).expect(200)

    expect(await column('done')).toEqual(['X', 'A', 'Y'])
    expect(await column('todo')).toEqual(['B', 'C'])
  })

  it('renumbers the column when two cards are too close to split, and keeps the order', async () => {
    const a = await insertTask(alice.id, { title: 'A', position: 1 })
    const b = await insertTask(alice.id, { title: 'B', position: 1 + 1e-9 })
    const x = await insertTask(alice.id, { title: 'X', position: 500 })

    await move(idOf(x), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) }).expect(200)

    expect(await column('todo')).toEqual(['A', 'X', 'B'])
    const positions = (await Task.find().sort({ position: 1 })).map((task) => task.position)
    expect(new Set(positions).size).toBe(3)
  })

  it('handles two cards with exactly the same position (newest sits above)', async () => {
    const a = await insertTask(alice.id, { title: 'A', position: 7 })
    const b = await insertTask(alice.id, { title: 'B', position: 7 })
    const x = await insertTask(alice.id, { title: 'X', position: 100 })
    expect(await column('todo')).toEqual(['B', 'A', 'X'])

    await move(idOf(x), { status: 'todo', afterId: idOf(b), beforeId: idOf(a) }).expect(200)

    expect(await column('todo')).toEqual(['B', 'X', 'A'])
  })

  it('moves a card to the top of a column whose top card has an unsplittable position', async () => {
    const huge = await insertTask(alice.id, { title: 'Huge', position: 1e300 })
    const x = await insertTask(alice.id, { title: 'X', position: 2e300 })

    await move(idOf(x), { status: 'todo', beforeId: idOf(huge) }).expect(200)

    expect(await column('todo')).toEqual(['X', 'Huge'])
  })

  it('answers 404 for an unknown task', async () => {
    await move('65f1c2a4b3d4e5f6a7b8c9d0', { status: 'done' }).expect(404)
  })

  it('answers 400 when a neighbour is the moved card itself', async () => {
    const { a } = await seedABC()

    await move(idOf(a), { status: 'todo', afterId: idOf(a) }).expect(400)
    await move(idOf(a), { status: 'todo', beforeId: idOf(a) }).expect(400)
  })

  it('answers 400 when a neighbour is the moved card itself written in upper case', async () => {
    const { a, b } = await seedABC()
    const upper = idOf(a).toUpperCase()

    await move(idOf(a), { status: 'todo', afterId: upper }).expect(400)
    await move(idOf(a), { status: 'todo', beforeId: upper }).expect(400)
    await move(upper, { status: 'todo', afterId: idOf(a) }).expect(400)
    expect(await column('todo')).toEqual(['A', 'B', 'C'])
    expect(await Task.findById(b._id).lean()).toMatchObject({ position: POSITION_STEP })
  })

  it('answers 409 when a neighbour was deleted meanwhile, and the board is unchanged', async () => {
    const { a, b } = await seedABC()
    await Task.deleteOne({ _id: b._id })

    const res = await move(idOf(a), { status: 'todo', afterId: idOf(b) })

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/board changed/i)
    expect(await column('todo')).toEqual(['A', 'C'])
  })

  it('answers 409 when a neighbour is in a different column', async () => {
    const { a } = await seedABC()
    const elsewhere = await insertTask(alice.id, { title: 'E', status: 'done' })

    await move(idOf(a), { status: 'todo', afterId: idOf(elsewhere) }).expect(409)
    await move(idOf(a), { status: 'todo', beforeId: idOf(elsewhere) }).expect(409)
  })

  it('answers 409 when the neighbours are in the wrong order', async () => {
    const { a, b, c } = await seedABC()

    await move(idOf(c), { status: 'todo', afterId: idOf(b), beforeId: idOf(a) }).expect(409)
    expect(await column('todo')).toEqual(['A', 'B', 'C'])
  })

  it('answers 409 when equal-position neighbours are given against the board order', async () => {
    const a = await insertTask(alice.id, { title: 'A', position: 7 })
    const b = await insertTask(alice.id, { title: 'B', position: 7 })
    const x = await insertTask(alice.id, { title: 'X', position: 100 })

    await move(idOf(x), { status: 'todo', afterId: idOf(a), beforeId: idOf(b) }).expect(409)
  })

  it('answers 409 when both neighbours are the same card', async () => {
    const { a, b } = await seedABC()

    await move(idOf(a), { status: 'todo', afterId: idOf(b), beforeId: idOf(b) }).expect(409)
  })

  it("treats another user's cards as if they did not exist", async () => {
    const { a } = await seedABC()
    const theirs = await insertTask(bob.id, { title: 'Theirs', position: POSITION_STEP })

    await move(idOf(a), { status: 'todo', afterId: idOf(theirs) }).expect(409)
    await move(idOf(theirs), { status: 'todo' }).expect(404)
    expect(await Task.findById(theirs._id).lean()).toMatchObject({
      title: 'Theirs',
      position: 1024,
    })
  })

  it('rejects a malformed body', async () => {
    const { a } = await seedABC()

    await move(idOf(a), { status: 'archived' }).expect(400)
    await move(idOf(a), { status: 'todo', afterId: 'nope' }).expect(400)
  })
})
