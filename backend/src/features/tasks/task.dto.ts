import { formatCalendarDate } from '../../shared/dates/calendarDate.ts'
import type { TaskPriority, TaskRecord, TaskStatus } from './task.model.ts'

export interface TaskDto {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  tags: string[]
  position: number
  createdAt: string
  updatedAt: string
}

export function toTaskDto(task: TaskRecord): TaskDto {
  return {
    id: task._id.toString(),
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatCalendarDate(task.dueDate) : null,
    tags: task.tags,
    position: task.position,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}
