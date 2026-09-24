export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** YYYY-MM-DD */
  dueDate: string | null
  tags: string[]
  position: number
  createdAt: string
  updatedAt: string
}

export interface TaskPage {
  items: Task[]
  page: number
  limit: number
  total: number
}

export interface BoardFilters {
  tag?: string
  q?: string
}

export interface TaskInput {
  title: string
  description: string
  priority: TaskPriority
  dueDate: string | null
  tags: string[]
}
