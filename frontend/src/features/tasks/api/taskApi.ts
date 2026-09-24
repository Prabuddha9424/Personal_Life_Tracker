import { httpClient } from '@/shared/api/httpClient'
import type { Task, TaskInput, TaskPage, TaskStatus } from '../types'

export interface ListTasksParams {
  status?: TaskStatus
  tag?: string
  q?: string
  dueBefore?: string
  open?: boolean
  sort?: 'position' | 'dueDate'
  page?: number
  limit?: number
}

export async function listTasks(params: ListTasksParams): Promise<TaskPage> {
  const { data } = await httpClient.get<TaskPage>('/tasks', { params })
  return data
}

export async function fetchTags(): Promise<string[]> {
  const { data } = await httpClient.get<{ tags: string[] }>('/tasks/tags')
  return data.tags
}

export async function createTask(input: TaskInput & { status?: TaskStatus }): Promise<Task> {
  const { data } = await httpClient.post<Task>('/tasks', input)
  return data
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<Task> {
  const { data } = await httpClient.patch<Task>(`/tasks/${id}`, input)
  return data
}

export async function deleteTask(id: string): Promise<void> {
  await httpClient.delete(`/tasks/${id}`)
}

export async function moveTask(
  id: string,
  input: { status: TaskStatus; afterId?: string; beforeId?: string },
): Promise<Task> {
  const { data } = await httpClient.post<Task>(`/tasks/${id}/move`, input)
  return data
}
