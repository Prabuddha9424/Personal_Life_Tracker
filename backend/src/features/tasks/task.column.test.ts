import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { BOARD_ORDER, rebalanceColumn } from './task.column.ts'
import { Task } from './task.model.ts'
import { POSITION_STEP } from './task.ordering.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(async () => {
  vi.restoreAllMocks()
  await clearTestDb()
})
afterAll(stopTestDb)

const alice = testUser()

describe('rebalanceColumn', () => {
  it('renumbers a column 0, 1024, 2048 in board order', async () => {
    await insertTask(alice.id, { title: 'A', position: 3 })
    await insertTask(alice.id, { title: 'B', position: 9 })
    await insertTask(alice.id, { title: 'C', position: 10 })

    await rebalanceColumn(new Types.ObjectId(alice.id), 'todo')

    const cards = await Task.find().sort(BOARD_ORDER).lean()
    expect(cards.map((c) => [c.title, c.position])).toEqual([
      ['A', 0],
      ['B', POSITION_STEP],
      ['C', 2 * POSITION_STEP],
    ])
  })

  it('does not rewrite a card that moved to another column after the rebalance read it', async () => {
    const stay = await insertTask(alice.id, { title: 'stay', position: 5 })
    const leaves = await insertTask(alice.id, { title: 'leaves', position: 6 })
    const realBulkWrite = Task.bulkWrite.bind(Task)
    vi.spyOn(Task, 'bulkWrite').mockImplementationOnce(async (ops, options) => {
      await Task.updateOne({ _id: leaves._id }, { $set: { status: 'done', position: 77 } })
      return realBulkWrite(ops, options)
    })

    await rebalanceColumn(new Types.ObjectId(alice.id), 'todo')

    expect(await Task.findById(leaves._id).lean()).toMatchObject({ status: 'done', position: 77 })
    expect(await Task.findById(stay._id).lean()).toMatchObject({ status: 'todo', position: 0 })
  })
})

describe('the board index', () => {
  it('serves the board order without an in-memory sort', async () => {
    await insertTask(alice.id, { title: 'A', position: 1 })
    await insertTask(alice.id, { title: 'B', position: 1 })

    const plan = await Task.collection
      .find({ userId: new Types.ObjectId(alice.id), status: 'todo' })
      .sort(BOARD_ORDER)
      .explain('queryPlanner')

    const winning = JSON.stringify(plan.queryPlanner.winningPlan)
    expect(winning).toContain('"stage":"IXSCAN"')
    expect(winning).not.toContain('"stage":"SORT"')
  })
})
