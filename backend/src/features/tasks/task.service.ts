import { Types, type QueryFilter } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { paginated, toSkip, type Paginated } from '../../shared/validation/requestSchemas.ts'
import { toTaskDto, type TaskDto } from './task.dto.ts'
import { Task, type TaskAttrs, type TaskRecord } from './task.model.ts'
import { positionBetween } from './task.ordering.ts'
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schemas.ts'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function createTask(userId: string, input: CreateTaskInput): Promise<TaskDto> {
  const owner = new Types.ObjectId(userId)
  const top = await Task.findOne({ userId: owner, status: input.status })
    .sort({ position: 1, _id: 1 })
    .select('position')
    .lean<{ position: number } | null>()

  const task = await Task.create({
    userId: owner,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate ? parseCalendarDate(input.dueDate) : undefined,
    tags: input.tags,
    position: positionBetween(undefined, top?.position) ?? 0,
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
  const task = await Task.findOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (!task) throw new AppError(404, 'Task not found')

  if (input.title !== undefined) task.title = input.title
  if (input.description !== undefined) task.description = input.description
  if (input.priority !== undefined) task.priority = input.priority
  if (input.tags !== undefined) task.tags = input.tags
  if (input.dueDate !== undefined) {
    task.dueDate = input.dueDate === null ? undefined : parseCalendarDate(input.dueDate)
  }

  await task.save()
  return toTaskDto(task.toObject<TaskRecord>())
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
    query.sort === 'dueDate' ? { dueDate: 1, position: 1, _id: 1 } : { position: 1, _id: 1 }

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
