import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { deleteTasksForUser, exportTasksForUser } from './index.ts'
import { Task } from './task.model.ts'
import { insertTask } from './task.test-helpers.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('tasks public API', () => {
  it("exports only the user's own tasks, in board order", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTask(alice.id, { title: 'todo 2', position: 2 })
    await insertTask(alice.id, { title: 'todo 1', position: 1 })
    await insertTask(alice.id, {
      title: 'done 1',
      status: 'done',
      dueDate: new Date('2026-10-01T00:00:00Z'),
    })
    await insertTask(bob.id, { title: 'not yours' })

    const exported = await exportTasksForUser(alice.id)

    expect(exported.map((t) => t.title)).toEqual(['done 1', 'todo 1', 'todo 2'])
    expect(exported[0]?.dueDate).toBe('2026-10-01')
  })

  it('exports an empty list for a user without tasks', async () => {
    expect(await exportTasksForUser(testUser().id)).toEqual([])
  })

  it("deletes all of one user's tasks and leaves everyone else's", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTask(alice.id)
    await insertTask(alice.id)
    await insertTask(bob.id)

    await deleteTasksForUser(alice.id)

    expect(await Task.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Task.countDocuments({ userId: bob.id })).toBe(1)
  })
})
