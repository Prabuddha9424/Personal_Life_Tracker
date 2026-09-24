import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/shared/ui/toast'
import { flattenColumn, type ColumnData } from '../boardCache'
import type { Task, TaskPage } from '../types'
import * as taskApi from './taskApi'
import {
  useColumnTasks,
  useCreateTask,
  useDeleteTask,
  useDueSoonTasks,
  useMoveTask,
  useTags,
  useUpdateTask,
} from './hooks'
import { taskKeys } from './taskKeys'

vi.mock('./taskApi')

function task(id: string, status: Task['status'] = 'todo'): Task {
  return {
    id,
    title: id,
    description: '',
    status,
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const page = (items: Task[], total = items.length): TaskPage => ({
  items,
  page: 1,
  limit: 50,
  total,
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const ids = (client: QueryClient, status: Task['status']) =>
  flattenColumn(client.getQueryData<ColumnData>(taskKeys.column(status, {}))).map((t) => t.id)

beforeEach(() => {
  vi.resetAllMocks()
  useToastStore.setState({ toasts: [] })
})

describe('useColumnTasks', () => {
  it('asks for one page of one column and offers the next page while there is more', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([task('a')], 120))
    const { wrapper } = setup()

    const { result } = renderHook(() => useColumnTasks('todo', { tag: 'home' }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(taskApi.listTasks).mock.calls[0]?.[0]).toEqual({
      status: 'todo',
      tag: 'home',
      page: 1,
      limit: 50,
    })
    expect(result.current.hasNextPage).toBe(true)
  })

  it('stops offering pages once everything is loaded', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([task('a')], 1))
    const { wrapper } = setup()

    const { result } = renderHook(() => useColumnTasks('todo', {}), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useDueSoonTasks', () => {
  it('asks for open tasks due within the window, soonest first', async () => {
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { wrapper } = setup()

    const { result } = renderHook(() => useDueSoonTasks(7), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(taskApi.listTasks).mock.calls[0]?.[0]).toMatchObject({
      open: true,
      sort: 'dueDate',
      dueBefore: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })
})

describe('useMoveTask', () => {
  function seed(client: QueryClient) {
    client.setQueryData<ColumnData>(taskKeys.column('todo', {}), {
      pageParams: [1],
      pages: [page([task('a'), task('b')])],
    })
    client.setQueryData<ColumnData>(taskKeys.column('done', {}), {
      pageParams: [1],
      pages: [page([task('x', 'done')])],
    })
  }

  it('moves the card in the cache immediately, then refetches', async () => {
    let finish: (value: Task) => void = () => {}
    vi.mocked(taskApi.moveTask).mockReturnValue(new Promise<Task>((resolve) => (finish = resolve)))
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { client, wrapper } = setup()
    seed(client)
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    act(() => {
      result.current.mutate({
        task: task('a'),
        toStatus: 'done',
        toIndex: 0,
        filters: {},
        beforeId: 'x',
      })
    })

    await waitFor(() => expect(ids(client, 'done')).toEqual(['a', 'x']))
    expect(ids(client, 'todo')).toEqual(['b'])
    expect(vi.mocked(taskApi.moveTask).mock.calls[0]).toEqual([
      'a',
      { status: 'done', afterId: undefined, beforeId: 'x' },
    ])

    finish(task('a', 'done'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('rolls the board back and tells the user when the server refuses the move', async () => {
    vi.mocked(taskApi.moveTask).mockRejectedValue(new Error('Network Error'))
    vi.mocked(taskApi.listTasks).mockResolvedValue(page([]))
    const { client, wrapper } = setup()
    seed(client)
    const { result } = renderHook(() => useMoveTask(), { wrapper })

    act(() => {
      result.current.mutate({ task: task('a'), toStatus: 'done', toIndex: 1, filters: {} })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: 'error' })
    expect(useToastStore.getState().toasts[0]?.message).toMatch(/could not move/i)
  })
})

describe('useMoveTask on a live board', () => {
  const serverColumns: Record<string, Task[]> = {
    todo: [task('a'), task('b')],
    done: [task('x', 'done')],
  }

  function useBoard() {
    return {
      todo: useColumnTasks('todo', {}),
      done: useColumnTasks('done', {}),
      move: useMoveTask(),
    }
  }

  async function mountBoard() {
    vi.mocked(taskApi.listTasks).mockImplementation(({ status }) =>
      Promise.resolve(page(serverColumns[status ?? 'todo'] ?? [])),
    )
    const { client, wrapper } = setup()
    const hook = renderHook(useBoard, { wrapper })
    await waitFor(() => expect(ids(client, 'done')).toEqual(['x']))
    expect(ids(client, 'todo')).toEqual(['a', 'b'])
    vi.mocked(taskApi.listTasks).mockClear()
    return { client, ...hook }
  }

  it('restores the exact previous cache before the refetch lands, then refetches both columns', async () => {
    const { client, result } = await mountBoard()
    const todoBefore = client.getQueryData<ColumnData>(taskKeys.column('todo', {}))
    const doneBefore = client.getQueryData<ColumnData>(taskKeys.column('done', {}))
    let release: (value: TaskPage) => void = () => {}
    vi.mocked(taskApi.listTasks).mockReturnValue(
      new Promise<TaskPage>((resolve) => (release = resolve)),
    )
    vi.mocked(taskApi.moveTask).mockRejectedValue(new Error('Conflict'))

    act(() => {
      result.current.move.mutate({
        task: task('a'),
        toStatus: 'done',
        toIndex: 0,
        filters: {},
        beforeId: 'x',
      })
    })

    await waitFor(() => expect(vi.mocked(taskApi.listTasks)).toHaveBeenCalled())
    expect(client.getQueryData(taskKeys.column('todo', {}))).toEqual(todoBefore)
    expect(client.getQueryData(taskKeys.column('done', {}))).toEqual(doneBefore)
    expect(
      vi
        .mocked(taskApi.listTasks)
        .mock.calls.map((call) => call[0].status)
        .sort(),
    ).toEqual(['done', 'todo'])

    release(page([]))
    await waitFor(() => expect(result.current.move.isError).toBe(true))
  })

  it('refetches after a successful move too', async () => {
    const { result } = await mountBoard()
    vi.mocked(taskApi.moveTask).mockResolvedValue(task('a', 'done'))

    act(() => {
      result.current.move.mutate({
        task: task('a'),
        toStatus: 'done',
        toIndex: 1,
        filters: {},
        afterId: 'x',
      })
    })

    await waitFor(() => expect(result.current.move.isSuccess).toBe(true))
    expect(vi.mocked(taskApi.listTasks)).toHaveBeenCalledTimes(2)
  })

  it('cancels a column fetch that is in flight so it cannot overwrite the optimistic card', async () => {
    const { client, result } = await mountBoard()
    let releaseStale: (value: TaskPage) => void = () => {}
    vi.mocked(taskApi.listTasks).mockReturnValueOnce(
      new Promise<TaskPage>((resolve) => (releaseStale = resolve)),
    )
    vi.mocked(taskApi.moveTask).mockReturnValue(new Promise<Task>(() => {}))
    void client.refetchQueries({ queryKey: taskKeys.column('todo', {}) })
    await waitFor(() => expect(vi.mocked(taskApi.listTasks)).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.move.mutate({
        task: task('a'),
        toStatus: 'done',
        toIndex: 0,
        filters: {},
        beforeId: 'x',
      })
    })
    await waitFor(() => expect(ids(client, 'done')).toEqual(['a', 'x']))
    releaseStale(page([task('a'), task('b')]))

    await act(async () => {
      await Promise.resolve()
    })
    expect(ids(client, 'todo')).toEqual(['b'])
    expect(ids(client, 'done')).toEqual(['a', 'x'])
  })

  it('never duplicates a card that the destination already holds', async () => {
    const { client, result } = await mountBoard()
    vi.mocked(taskApi.moveTask).mockReturnValue(new Promise<Task>(() => {}))

    act(() => {
      result.current.move.mutate({
        task: task('x', 'done'),
        toStatus: 'done',
        toIndex: 0,
        filters: {},
      })
    })

    await waitFor(() => expect(taskApi.moveTask).toHaveBeenCalled())
    expect(ids(client, 'done')).toEqual(['x'])
  })

  it('leaves the cache alone for a card that is no longer on the board, and still asks the server', async () => {
    const { client, result } = await mountBoard()
    vi.mocked(taskApi.moveTask).mockRejectedValue(new Error('Task not found'))

    act(() => {
      result.current.move.mutate({
        task: task('gone'),
        toStatus: 'done',
        toIndex: 0,
        filters: {},
        beforeId: 'x',
      })
    })

    await waitFor(() => expect(result.current.move.isError).toBe(true))
    expect(ids(client, 'todo')).toEqual(['a', 'b'])
    expect(ids(client, 'done')).toEqual(['x'])
    expect(taskApi.moveTask).toHaveBeenCalledTimes(1)
  })
})

describe('mutations', () => {
  it('refresh the board, tags and due-soon after a create, update or delete', async () => {
    vi.mocked(taskApi.createTask).mockResolvedValue(task('n'))
    vi.mocked(taskApi.updateTask).mockResolvedValue(task('n'))
    vi.mocked(taskApi.deleteTask).mockResolvedValue()
    const { client, wrapper } = setup()
    seedAll(client)
    const { result } = renderHook(
      () => ({ create: useCreateTask(), update: useUpdateTask(), remove: useDeleteTask() }),
      { wrapper },
    )
    const input = { title: 't', description: '', priority: 'low' as const, dueDate: null, tags: [] }

    await act(() => result.current.create.mutateAsync(input))
    expect(allStale(client)).toBe(true)

    seedAll(client)
    await act(() => result.current.update.mutateAsync({ id: 'n', input: { title: 'u' } }))
    expect(allStale(client)).toBe(true)

    seedAll(client)
    await act(() => result.current.remove.mutateAsync('n'))
    expect(allStale(client)).toBe(true)
    expect(taskApi.deleteTask).toHaveBeenCalledWith('n', expect.anything())
  })

  it('tell the user why a create, update or delete failed', async () => {
    vi.mocked(taskApi.createTask).mockRejectedValue(new Error('Title is required'))
    vi.mocked(taskApi.updateTask).mockRejectedValue(new Error('Task not found'))
    vi.mocked(taskApi.deleteTask).mockRejectedValue(new Error('Task not found'))
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({ create: useCreateTask(), update: useUpdateTask(), remove: useDeleteTask() }),
      { wrapper },
    )
    const input = { title: '', description: '', priority: 'low' as const, dueDate: null, tags: [] }

    await act(async () => {
      await result.current.create.mutateAsync(input).catch(() => undefined)
      await result.current.update.mutateAsync({ id: 'n', input }).catch(() => undefined)
      await result.current.remove.mutateAsync('n').catch(() => undefined)
    })

    const messages = useToastStore.getState().toasts.map((toast) => toast.message)
    expect(messages).toEqual([
      'Could not create the task. Title is required',
      'Could not save the task. Task not found',
      'Could not delete the task. Task not found',
    ])
  })
})

describe('useTags', () => {
  it('loads the tag list', async () => {
    vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
    const { wrapper } = setup()

    const { result } = renderHook(() => useTags(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(['home', 'work']))
  })
})

function seedAll(client: QueryClient) {
  client.setQueryData(taskKeys.column('todo', {}), { pageParams: [1], pages: [page([task('a')])] })
  client.setQueryData(taskKeys.tags, ['home'])
  client.setQueryData(taskKeys.dueSoon(7), page([]))
}

function allStale(client: QueryClient): boolean {
  return client
    .getQueryCache()
    .findAll({ queryKey: taskKeys.all })
    .every((query) => query.isStale())
}
