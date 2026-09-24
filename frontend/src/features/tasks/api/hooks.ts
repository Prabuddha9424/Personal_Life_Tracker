import {
  hashKey,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { getErrorMessage } from '@/shared/api/httpClient'
import { addDaysIso, todayIso } from '@/shared/lib/dates'
import { pushToast } from '@/shared/ui/toast'
import { flattenColumn, insertTask, removeTask, type ColumnData } from '../boardCache'
import type { BoardFilters, Task, TaskInput, TaskPage, TaskStatus } from '../types'
import { createTask, deleteTask, fetchTags, listTasks, moveTask, updateTask } from './taskApi'
import { taskKeys } from './taskKeys'

const PAGE_SIZE = 50

export function useColumnTasks(status: TaskStatus, filters: BoardFilters) {
  return useInfiniteQuery<TaskPage, Error, ColumnData, ReturnType<typeof taskKeys.column>, number>({
    queryKey: taskKeys.column(status, filters),
    queryFn: ({ pageParam }) =>
      listTasks({ status, ...filters, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
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
  })
}

export function useUpdateTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TaskInput> }) => updateTask(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: taskKeys.all }),
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

interface TrackedMove {
  variables: MoveVariables
  /** False when the card was not on the board, so nothing was written to the cache. */
  applied: boolean
  state: 'pending' | 'accepted' | 'refused'
}

/** Every move that is in flight together, and the column caches as they were before the first. */
interface MoveBatch {
  baseline: Map<string, ColumnSnapshot>
  moves: TrackedMove[]
  /** Moves that have started (counted before the first await) and not yet settled. */
  pending: number
}

const MOVE_KEY = ['tasks', 'move'] as const

/** One batch per QueryClient, so a fresh client (a test, a new session) starts clean. */
const batches = new WeakMap<QueryClient, MoveBatch>()

function isOnBoard(client: QueryClient, { task, filters }: MoveVariables): boolean {
  const data = client.getQueryData<ColumnData>(taskKeys.column(task.status, filters))
  return flattenColumn(data).some((item) => item.id === task.id)
}

function writeMove(client: QueryClient, { task, toStatus, toIndex, filters }: MoveVariables) {
  client.setQueryData<ColumnData>(
    taskKeys.column(task.status, filters),
    (data) => data && removeTask(data, task.id),
  )
  client.setQueryData<ColumnData>(
    taskKeys.column(toStatus, filters),
    (data) => data && insertTask(removeTask(data, task.id), { ...task, status: toStatus }, toIndex),
  )
}

/** Rebuilds the board from the state before the batch plus only the moves the server allowed. */
function reconcile(client: QueryClient, batch: MoveBatch) {
  for (const { key, data } of batch.baseline.values()) {
    if (data !== undefined) client.setQueryData(key, data)
  }
  for (const move of batch.moves) {
    if (move.applied && move.state !== 'refused' && isOnBoard(client, move.variables)) {
      writeMove(client, move.variables)
    }
  }
}

function findPending(batch: MoveBatch | undefined, variables: MoveVariables) {
  return batch?.moves.find((move) => move.variables === variables && move.state === 'pending')
}

/**
 * Moves a card in the cache at once. The server can still refuse (a neighbour was deleted or
 * moved, the order is wrong), and several moves can overlap, so a refusal never restores its own
 * snapshot: that could re-apply another move that was refused, or wipe one still in flight.
 * Instead the cache is left alone until the LAST in-flight move settles. If any move in the
 * batch was refused, the board is then rebuilt from the state before the batch plus the moves the
 * server accepted, so it is correct even if the refetch that follows fails. That refetch always
 * runs, on success or error.
 *
 * "Last" is a counter kept on the batch, raised before the first await and lowered in onSettled,
 * so it cannot be fooled by moves that settle in the same tick. The batch is deleted when the
 * counter reaches zero. A move is matched to its record by its variables object, not by the
 * mutation context, so a move whose onMutate threw still counts as refused.
 */
export function useMoveTask() {
  const client = useQueryClient()

  return useMutation({
    mutationKey: MOVE_KEY,
    mutationFn: ({ task, toStatus, afterId, beforeId }: MoveVariables) =>
      moveTask(task.id, { status: toStatus, afterId, beforeId }),

    onMutate: async (variables) => {
      const batch = batches.get(client) ?? {
        baseline: new Map<string, ColumnSnapshot>(),
        moves: [],
        pending: 0,
      }
      batches.set(client, batch)
      batch.pending += 1

      await client.cancelQueries({ queryKey: taskKeys.columns })

      const { task, toStatus, filters } = variables
      for (const key of [
        taskKeys.column(task.status, filters),
        taskKeys.column(toStatus, filters),
      ]) {
        const id = hashKey(key)
        if (!batch.baseline.has(id)) {
          batch.baseline.set(id, { key, data: client.getQueryData<ColumnData>(key) })
        }
      }

      const move: TrackedMove = {
        variables,
        applied: isOnBoard(client, variables),
        state: 'pending',
      }
      batch.moves.push(move)
      if (move.applied) writeMove(client, variables)
    },

    onError: (error, variables) => {
      const move = findPending(batches.get(client), variables)
      if (move) move.state = 'refused'
      pushToast(`Could not move the task. ${getErrorMessage(error)}`, 'error')
    },

    onSettled: (_data, _error, variables) => {
      const batch = batches.get(client)
      if (!batch) return client.invalidateQueries({ queryKey: taskKeys.all })
      const move = findPending(batch, variables)
      if (move) move.state = 'accepted'

      batch.pending -= 1
      if (batch.pending > 0) return
      batches.delete(client)
      if (batch.moves.some((tracked) => tracked.state === 'refused')) reconcile(client, batch)
      return client.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}
