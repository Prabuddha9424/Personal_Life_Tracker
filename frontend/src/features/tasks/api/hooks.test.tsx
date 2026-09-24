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

  it('leave create and update errors to the form but toast a failed delete', async () => {
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
    })

    await waitFor(() => expect(result.current.create.error?.message).toBe('Title is required'))
    await waitFor(() => expect(result.current.update.error?.message).toBe('Task not found'))
    expect(useToastStore.getState().toasts).toEqual([])

    await act(async () => {
      await result.current.remove.mutateAsync('n').catch(() => undefined)
    })

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
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

describe('useColumnTasks while the filters change', () => {
  it('keeps showing the previous cards until the new filter has loaded', async () => {
    let release: (value: TaskPage) => void = () => {}
    vi.mocked(taskApi.listTasks).mockImplementation(({ tag }) =>
      tag === 'home'
        ? Promise.resolve(page([task('a')]))
        : new Promise<TaskPage>((resolve) => (release = resolve)),
    )
    const { wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) => useColumnTasks('todo', { tag }),
      { wrapper, initialProps: { tag: 'home' } },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    rerender({ tag: 'work' })

    expect(result.current.isPlaceholderData).toBe(true)
    expect(flattenColumn(result.current.data).map((t) => t.id)).toEqual(['a'])

    release(page([task('w')]))
    await waitFor(() => expect(flattenColumn(result.current.data).map((t) => t.id)).toEqual(['w']))
    expect(result.current.isPlaceholderData).toBe(false)
  })
})

describe('overlapping moves', () => {
  interface Deferred {
    promise: Promise<Task>
    resolve: (value: Task) => void
    reject: (error: Error) => void
  }

  function deferred(): Deferred {
    let resolve: Deferred['resolve'] = () => {}
    let reject: Deferred['reject'] = () => {}
    const promise = new Promise<Task>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  type MoveArgs = Parameters<ReturnType<typeof useMoveTask>['mutate']>[0]

  const original: Record<string, Task[]> = {
    todo: [task('a'), task('b')],
    done: [task('x', 'done')],
  }

  async function mountBoard(refetchFails: boolean) {
    vi.mocked(taskApi.listTasks).mockImplementation(({ status }) =>
      Promise.resolve(page(original[status ?? 'todo'] ?? [])),
    )
    const { client, wrapper } = setup()
    const hook = renderHook(
      () => ({
        todo: useColumnTasks('todo', {}),
        done: useColumnTasks('done', {}),
        move: useMoveTask(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(ids(client, 'done')).toEqual(['x']))
    vi.mocked(taskApi.listTasks).mockClear()
    if (refetchFails) vi.mocked(taskApi.listTasks).mockRejectedValue(new Error('offline'))

    const first = deferred()
    const second = deferred()
    vi.mocked(taskApi.moveTask)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const moveA = () =>
      hook.result.current.move
        .mutateAsync({ task: task('a'), toStatus: 'done', toIndex: 0, filters: {}, beforeId: 'x' })
        .catch(() => undefined)
    const moveB = () =>
      hook.result.current.move
        .mutateAsync({ task: task('b'), toStatus: 'done', toIndex: 0, filters: {}, beforeId: 'x' })
        .catch(() => undefined)
    const moveWith = (variables: Pick<MoveArgs, 'task' | 'toStatus' | 'toIndex'>) =>
      hook.result.current.move.mutateAsync({ ...variables, filters: {} }).catch(() => undefined)
    return { client, first, second, moveA, moveB, moveWith }
  }

  async function startBoth(board: Awaited<ReturnType<typeof mountBoard>>) {
    let a: Promise<unknown> = Promise.resolve()
    let b: Promise<unknown> = Promise.resolve()
    act(() => {
      a = board.moveA()
    })
    await waitFor(() => expect(ids(board.client, 'done')).toEqual(['a', 'x']))
    act(() => {
      b = board.moveB()
    })
    await waitFor(() => expect(ids(board.client, 'done')).toEqual(['b', 'a', 'x']))
    return { a, b }
  }

  it('ends on the original server state when both moves fail and the refetch fails too', async () => {
    const board = await mountBoard(true)
    const { a, b } = await startBoth(board)

    await act(async () => {
      board.first.reject(new Error('Conflict'))
      await a
    })
    await act(async () => {
      board.second.reject(new Error('Conflict'))
      await b
    })

    expect(ids(board.client, 'todo')).toEqual(['a', 'b'])
    expect(ids(board.client, 'done')).toEqual(['x'])
  })

  it('keeps the other move visible while the first one fails, then drops only the refused move', async () => {
    const board = await mountBoard(true)
    const { a, b } = await startBoth(board)

    await act(async () => {
      board.first.reject(new Error('Conflict'))
      await a
    })

    expect(ids(board.client, 'done')).toContain('b')
    expect(vi.mocked(taskApi.listTasks)).not.toHaveBeenCalled()

    await act(async () => {
      board.second.resolve(task('b', 'done'))
      await b
    })

    expect(ids(board.client, 'todo')).toEqual(['a'])
    expect(ids(board.client, 'done')).toEqual(['b', 'x'])
    expect(vi.mocked(taskApi.listTasks)).toHaveBeenCalled()
  })

  it('keeps the accepted move when the later one is refused and the refetch fails', async () => {
    const board = await mountBoard(true)
    const { a, b } = await startBoth(board)

    await act(async () => {
      board.first.resolve(task('a', 'done'))
      await a
    })
    expect(vi.mocked(taskApi.listTasks)).not.toHaveBeenCalled()
    await act(async () => {
      board.second.reject(new Error('Conflict'))
      await b
    })

    expect(ids(board.client, 'todo')).toEqual(['b'])
    expect(ids(board.client, 'done')).toEqual(['a', 'x'])
  })

  it('refetches once, after the last move settles, when both succeed', async () => {
    const board = await mountBoard(false)
    const { a, b } = await startBoth(board)

    await act(async () => {
      board.second.resolve(task('b', 'done'))
      await b
    })
    expect(vi.mocked(taskApi.listTasks)).not.toHaveBeenCalled()
    await act(async () => {
      board.first.resolve(task('a', 'done'))
      await a
    })

    expect(vi.mocked(taskApi.listTasks)).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['accepted', 'accepted', ['todo', []], ['done', ['b', 'a', 'x']]],
    ['refused', 'refused', ['todo', ['a', 'b']], ['done', ['x']]],
    ['accepted', 'refused', ['todo', ['b']], ['done', ['a', 'x']]],
    ['refused', 'accepted', ['todo', ['a']], ['done', ['b', 'x']]],
  ] as const)(
    'closes the batch when moves A (%s) and B (%s) settle in the same tick',
    async (outcomeA, outcomeB, [todoStatus, todoIds], [doneStatus, doneIds]) => {
      const board = await mountBoard(true)
      const invalidate = vi.spyOn(board.client, 'invalidateQueries')
      const { a, b } = await startBoth(board)
      const settle = (move: Deferred, outcome: 'accepted' | 'refused', id: string) =>
        outcome === 'accepted' ? move.resolve(task(id, 'done')) : move.reject(new Error('Conflict'))

      await act(async () => {
        settle(board.first, outcomeA, 'a')
        settle(board.second, outcomeB, 'b')
        await Promise.all([a, b])
      })

      expect(ids(board.client, todoStatus)).toEqual(todoIds)
      expect(ids(board.client, doneStatus)).toEqual(doneIds)
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all })

      // The batch is gone: a new move takes a fresh baseline from the cache as it is now.
      const before = {
        todo: board.client.getQueryData(taskKeys.column('todo', {})),
        done: board.client.getQueryData(taskKeys.column('done', {})),
      }
      vi.mocked(taskApi.moveTask).mockRejectedValueOnce(new Error('Conflict'))
      const moveC = board.moveWith({ task: task('x', 'done'), toStatus: 'todo', toIndex: 0 })
      await act(async () => {
        await moveC
      })

      expect(board.client.getQueryData(taskKeys.column('todo', {}))).toEqual(before.todo)
      expect(board.client.getQueryData(taskKeys.column('done', {}))).toEqual(before.done)
    },
  )

  it('starts a second batch from the cache as the first one left it', async () => {
    const board = await mountBoard(true)
    const { a, b } = await startBoth(board)
    await act(async () => {
      board.first.resolve(task('a', 'done'))
      board.second.resolve(task('b', 'done'))
      await Promise.all([a, b])
    })
    vi.mocked(taskApi.moveTask).mockRejectedValueOnce(new Error('Conflict'))

    await act(async () => {
      await board.moveWith({ task: task('x', 'done'), toStatus: 'todo', toIndex: 0 })
    })

    expect(ids(board.client, 'done')).toEqual(['b', 'a', 'x'])
    expect(ids(board.client, 'todo')).toEqual([])
  })

  it('does not bring back old columns after the cache was cleared', async () => {
    const board = await mountBoard(true)
    const { a, b } = await startBoth(board)
    await act(async () => {
      board.first.reject(new Error('Conflict'))
      board.second.reject(new Error('Conflict'))
      await Promise.all([a, b])
    })

    board.client.clear()
    board.client.setQueryData<ColumnData>(taskKeys.column('todo', {}), {
      pageParams: [1],
      pages: [page([task('q')])],
    })
    board.client.setQueryData<ColumnData>(taskKeys.column('done', {}), {
      pageParams: [1],
      pages: [page([])],
    })
    vi.mocked(taskApi.moveTask).mockRejectedValueOnce(new Error('Conflict'))
    await act(async () => {
      await board.moveWith({ task: task('q'), toStatus: 'done', toIndex: 0 })
    })

    expect(ids(board.client, 'todo')).toEqual(['q'])
    expect(ids(board.client, 'done')).toEqual([])
  })

  it('keeps a card appended after a refused move that also appended', async () => {
    const board = await mountBoard(true)
    vi.mocked(taskApi.moveTask).mockReset()
    vi.mocked(taskApi.moveTask)
      .mockReturnValueOnce(board.first.promise)
      .mockReturnValueOnce(board.second.promise)
    let a: Promise<unknown> = Promise.resolve()
    let b: Promise<unknown> = Promise.resolve()
    act(() => {
      a = board.moveWith({ task: task('a'), toStatus: 'done', toIndex: 1 })
    })
    await waitFor(() => expect(ids(board.client, 'done')).toEqual(['x', 'a']))
    act(() => {
      b = board.moveWith({ task: task('b'), toStatus: 'done', toIndex: 2 })
    })
    await waitFor(() => expect(ids(board.client, 'done')).toEqual(['x', 'a', 'b']))

    await act(async () => {
      board.first.reject(new Error('Conflict'))
      board.second.resolve(task('b', 'done'))
      await Promise.all([a, b])
    })

    expect(ids(board.client, 'todo')).toEqual(['a'])
    expect(ids(board.client, 'done')).toEqual(['x', 'b'])
  })

  it('treats a move whose optimistic write threw as refused and still closes the batch', async () => {
    const board = await mountBoard(true)
    const invalidate = vi.spyOn(board.client, 'invalidateQueries')
    const original = board.client.setQueryData.bind(board.client)
    let writes = 0
    vi.spyOn(board.client, 'setQueryData').mockImplementation(((
      ...args: Parameters<typeof original>
    ) => {
      writes += 1
      if (writes === 2) throw new Error('cache write failed')
      return original(...args)
    }) as typeof original)

    await act(async () => {
      await board.moveWith({ task: task('a'), toStatus: 'done', toIndex: 0 })
    })

    expect(ids(board.client, 'todo')).toEqual(['a', 'b'])
    expect(ids(board.client, 'done')).toEqual(['x'])
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(taskApi.moveTask).not.toHaveBeenCalled()
  })
})
