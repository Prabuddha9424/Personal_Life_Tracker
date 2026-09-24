import { z } from 'zod'
import {
  calendarDateSchema,
  objectIdSchema,
  paginationQuerySchema,
} from '../../shared/validation/requestSchemas.ts'
import { TASK_PRIORITIES, TASK_STATUSES } from './task.model.ts'

const tagSchema = z.string().trim().toLowerCase().min(1).max(30)

/** Trimmed, lower-cased, de-duplicated, at most 10. */
const tagsSchema = z
  .array(tagSchema)
  .max(10, 'Use at most 10 tags')
  .transform((tags) => [...new Set(tags)])

const titleSchema = z.string().trim().min(1, 'Title is required').max(200)
const descriptionSchema = z.string().max(5000)

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  status: z.enum(TASK_STATUSES).default('todo'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: calendarDateSchema.nullish(),
  tags: tagsSchema.default([]),
})

/** Status and position are deliberately absent: they change only through the move endpoint. */
export const updateTaskSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema,
    priority: z.enum(TASK_PRIORITIES),
    dueDate: calendarDateSchema.nullable(),
    tags: tagsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  afterId: objectIdSchema.optional(),
  beforeId: objectIdSchema.optional(),
})

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  tag: tagSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  dueBefore: calendarDateSchema.optional(),
  open: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(['position', 'dueDate']).default('position'),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type MoveTaskInput = z.infer<typeof moveTaskSchema>
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>
