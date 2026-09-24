import { Types, type QueryFilter, type UpdateQuery } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { paginated, toSkip, type Paginated } from '../../shared/validation/requestSchemas.ts'
import { BOARD_ORDER, rebalanceColumn } from './task.column.ts'
import { toTaskDto, type TaskDto } from './task.dto.ts'
import { Task, type TaskAttrs, type TaskRecord, type TaskStatus } from './task.model.ts'
import { positionBetween } from './task.ordering.ts'
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schemas.ts'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function positionAboveColumn(
  owner: Types.ObjectId,
  status: TaskStatus,
): Promise<number | null> {
  const top = await Task.findOne({ userId: owner, status })
    .sort(BOARD_ORDER)
    .select('position')
    .lean<{ position: number } | null>()
  return positionBetween(undefined, top?.position)
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<TaskDto> {
  const owner = new Types.ObjectId(userId)
  let position = await positionAboveColumn(owner, input.status)
  if (position === null) {
    await rebalanceColumn(owner, input.status)
    position = await positionAboveColumn(owner, input.status)
  }
  if (position === null) throw new AppError(409, 'The board changed. Refresh and try again.')

  const task = await Task.create({
    userId: owner,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate ? parseCalendarDate(input.dueDate) : undefined,
    tags: input.tags,
    position,
  })
  return toTaskDto(task.toObject<TaskRecord>())
}

export async function getTask(userId: string, id: string): Promise<TaskDto> {
  const task = await Task.findOne({
    _id: id,
    userId: new Types.ObjectId(userId),
  }).lean<TaskRecord | null>()
  if (!task) throw new AppError(404, 'Task not found')
  return toTaskDto(task)
}

export async function updateTask(
  userId: string,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskDto> {
  const changes: UpdateQuery<TaskAttrs> = {}
  const { dueDate, ...fields } = input
  if (Object.keys(fields).length > 0) changes.$set = fields
  if (dueDate !== undefined) {
    if (dueDate === null) changes.$unset = { dueDate: 1 }
    else changes.$set = { ...changes.$set, dueDate: parseCalendarDate(dueDate) }
  }

  const task = (await Task.findOneAndUpdate(
    { _id: id, userId: new Types.ObjectId(userId) },
    changes,
    { returnDocument: 'after', runValidators: true, lean: true },
  )) as TaskRecord | null
  if (!task) throw new AppError(404, 'Task not found')
  return toTaskDto(task)
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const result = await Task.deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (result.deletedCount === 0) throw new AppError(404, 'Task not found')
}

export async function listTasks(
  userId: string,
  query: ListTasksQuery,
): Promise<Paginated<TaskDto>> {
  const filter: QueryFilter<TaskAttrs> = { userId: new Types.ObjectId(userId) }
  if (query.status) filter.status = query.status
  if (query.open) {
    if (query.status === 'done') return paginated([], 0, query)
    filter.status = query.status ?? { $ne: 'done' }
  }
  if (query.tag) filter.tags = query.tag
  if (query.q) filter.title = { $regex: escapeRegExp(query.q), $options: 'i' }
  if (query.dueBefore) filter.dueDate = { $lte: parseCalendarDate(query.dueBefore) }

  const sort: Record<string, 1 | -1> =
    query.sort === 'dueDate' ? { dueDate: 1, ...BOARD_ORDER } : BOARD_ORDER

  const [tasks, total] = await Promise.all([
    Task.find(filter).sort(sort).skip(toSkip(query)).limit(query.limit).lean<TaskRecord[]>(),
    Task.countDocuments(filter),
  ])
  return paginated(tasks.map(toTaskDto), total, query)
}

export async function listTags(userId: string): Promise<string[]> {
  const tags = (await Task.distinct('tags', { userId: new Types.ObjectId(userId) })) as string[]
  return tags.sort()
}
