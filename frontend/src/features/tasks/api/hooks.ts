import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/shared/api/httpClient'
import { addDaysIso, todayIso } from '@/shared/lib/dates'
import { pushToast } from '@/shared/ui/toast'
import { flattenColumn, insertTask, removeTask, type ColumnData } from '../boardCache'
import type { BoardFilters, Task, TaskInput, TaskStatus } from '../types'
import { createTask, deleteTask, fetchTags, listTasks, moveTask, updateTask } from './taskApi'
import { taskKeys } from './taskKeys'

const PAGE_SIZE = 50

export function useColumnTasks(status: TaskStatus, filters: BoardFilters) {
  return useInfiniteQuery({
    queryKey: taskKeys.column(status, filters),
    queryFn: ({ pageParam }) =>
      listTasks({ status, ...filters, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  })
}

export function useTags() {
  return useQuery({ queryKey: taskKeys.tags, queryFn: fetchTags })
}

/** Open tasks due within the next `days` days, or already overdue. For the dashboard. */
export function useDueSoonTasks(days = 7) {
  return useQuery({
    queryKey: taskKeys.dueSoon(days),
    queryFn: () =>
      listTasks({
        open: true,
        dueBefore: addDaysIso(todayIso(), days),
        sort: 'dueDate',
        limit: PAGE_SIZE,
      }),
  })
}

export function useCreateTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
    onError: (error) => pushToast(`Could not create the task. ${getErrorMessage(error)}`, 'error'),
  })
}

export function useUpdateTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TaskInput> }) => updateTask(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
    onError: (error) => pushToast(`Could not save the task. ${getErrorMessage(error)}`, 'error'),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
    onError: (error) => pushToast(`Could not delete the task. ${getErrorMessage(error)}`, 'error'),
  })
}

interface MoveVariables {
  task: Task
  toStatus: TaskStatus
  /** Final index in the destination column, as reported by the drag library. */
  toIndex: number
  filters: BoardFilters
  afterId?: string
  beforeId?: string
}

interface ColumnSnapshot {
  key: ReturnType<typeof taskKeys.column>
  data: ColumnData | undefined
}

/**
 * Moves a card in the cache at once. The server can still refuse (a neighbour was deleted or
 * moved, the order is wrong), so the exact previous cache is restored on error, and the board is
 * refetched whether the move succeeded or not.
 */
export function useMoveTask() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({ task, toStatus, afterId, beforeId }: MoveVariables) =>
      moveTask(task.id, { status: toStatus, afterId, beforeId }),

    onMutate: async ({
      task,
      toStatus,
      toIndex,
      filters,
    }): Promise<{ previous: ColumnSnapshot[] }> => {
      await client.cancelQueries({ queryKey: taskKeys.columns })
      const fromKey = taskKeys.column(task.status, filters)
      const toKey = taskKeys.column(toStatus, filters)
      const previous: ColumnSnapshot[] = [
        { key: fromKey, data: client.getQueryData<ColumnData>(fromKey) },
        { key: toKey, data: client.getQueryData<ColumnData>(toKey) },
      ]

      const isOnBoard = flattenColumn(previous[0]?.data).some((item) => item.id === task.id)
      if (!isOnBoard) return { previous }

      client.setQueryData<ColumnData>(fromKey, (data) => data && removeTask(data, task.id))
      client.setQueryData<ColumnData>(
        toKey,
        (data) =>
          data && insertTask(removeTask(data, task.id), { ...task, status: toStatus }, toIndex),
      )
      return { previous }
    },

    onError: (error, _variables, context) => {
      for (const { key, data } of context?.previous ?? []) client.setQueryData(key, data)
      pushToast(`Could not move the task. ${getErrorMessage(error)}`, 'error')
    },

    onSettled: () => client.invalidateQueries({ queryKey: taskKeys.all }),
  })
}
