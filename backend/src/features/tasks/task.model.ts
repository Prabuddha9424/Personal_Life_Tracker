import { model, Schema, type Types } from 'mongoose'

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export interface TaskAttrs {
  userId: Types.ObjectId
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** UTC midnight of the due calendar day. */
  dueDate?: Date
  tags: string[]
  /** Ordering key inside a column, ascending. Not money. */
  position: number
}

/** What `.lean()` and `.toObject()` return: the attributes plus id and timestamps. */
export type TaskRecord = TaskAttrs & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }

const taskSchema = new Schema<TaskAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    status: { type: String, enum: TASK_STATUSES, default: 'todo', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium', required: true },
    dueDate: { type: Date },
    tags: { type: [String], default: [] },
    position: { type: Number, required: true },
  },
  { timestamps: true },
)

taskSchema.index({ userId: 1, status: 1, position: 1 })
taskSchema.index({ userId: 1, dueDate: 1 })
taskSchema.index({ userId: 1, tags: 1 })

export const Task = model<TaskAttrs>('Task', taskSchema)
