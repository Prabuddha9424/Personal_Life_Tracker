import type { BoardFilters, TaskStatus } from '../types'

export const taskKeys = {
  all: ['tasks'] as const,
  columns: ['tasks', 'column'] as const,
  column: (status: TaskStatus, filters: BoardFilters) =>
    ['tasks', 'column', status, filters] as const,
  dueSoon: (days: number) => ['tasks', 'due-soon', days] as const,
  tags: ['tasks', 'tags'] as const,
}
