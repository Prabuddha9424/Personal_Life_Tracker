import { Types } from 'mongoose'
import { Task, type TaskAttrs, type TaskRecord } from './task.model.ts'

/** Inserts a task straight into the database, bypassing the API (for arranging test state). */
export async function insertTask(
  userId: string,
  overrides: Partial<Omit<TaskAttrs, 'userId'>> = {},
): Promise<TaskRecord> {
  const task = await Task.create({
    userId: new Types.ObjectId(userId),
    title: 'A task',
    description: '',
    status: 'todo',
    priority: 'medium',
    tags: [],
    position: 0,
    ...overrides,
  })
  return task.toObject<TaskRecord>()
}
