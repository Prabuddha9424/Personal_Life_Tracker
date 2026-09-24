import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DragDropContextProps, DropResult } from '@hello-pangea/dnd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as taskApi from '../api/taskApi'
import type { Task, TaskStatus } from '../types'
import { TaskBoard } from './TaskBoard'

vi.mock('../api/taskApi')

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as DragDropContextProps['onDragEnd'] | undefined,
}))

vi.mock('@hello-pangea/dnd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hello-pangea/dnd')>()
  return {
    ...actual,
    DragDropContext: (props: DragDropContextProps) => {
      dnd.onDragEnd = props.onDragEnd
      return <actual.DragDropContext {...props} />
    },
  }
})

function task(id: string, status: TaskStatus, title = id): Task {
  return {
    id,
    title,
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

type Columns = Partial<Record<TaskStatus, Task[]>>

/** Serves each column; `pageSize` smaller than the column makes it multi-page. */
function serve(columns: Columns, { total, limit }: { total?: number; limit?: number } = {}) {
  vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
    const items = columns[params.status ?? 'todo'] ?? []
    return { items, page: params.page ?? 1, limit: limit ?? 50, total: total ?? items.length }
  })
}

function drop(result: { id: string; from: [TaskStatus, number]; to: [TaskStatus, number] }) {
  const dropResult: DropResult = {
    draggableId: result.id,
    type: 'DEFAULT',
    mode: 'FLUID',
    reason: 'DROP',
    source: { droppableId: result.from[0], index: result.from[1] },
    destination: { droppableId: result.to[0], index: result.to[1] },
    combine: null,
  }
  dnd.onDragEnd?.(dropResult, {
    announce: () => {},
  })
}

function setup(onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <TaskBoard filters={{}} onOpen={onOpen} onAdd={vi.fn()} />
    </QueryClientProvider>,
  )
  return { client, onOpen, ...view }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue([])
  vi.mocked(taskApi.moveTask).mockImplementation(async (id, input) => task(id, input.status))
})

describe('TaskBoard card activation', () => {
  it('opens the editor exactly once when the title is clicked', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    const { onOpen } = setup()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit task: Buy milk' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })

  it('opens the editor exactly once when Enter is pressed on the title button', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    const { onOpen } = setup()
    const button = await screen.findByRole('button', { name: 'Edit task: Buy milk' })

    button.focus()
    await userEvent.keyboard('{Enter}')

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('leaves the drag handle to dragging: it does not open the editor itself', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    const { onOpen } = setup()
    const title = await screen.findByRole('button', { name: 'Edit task: Buy milk' })
    const handle = title.closest('[data-rfd-drag-handle-draggable-id]')
    expect(handle).not.toBeNull()

    await userEvent.click(handle as HTMLElement)
    ;(handle as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('makes every card a keyboard-operable drag handle that is described to assistive tech', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    setup()
    const title = await screen.findByRole('button', { name: 'Edit task: Buy milk' })
    const handle = title.closest('[data-rfd-drag-handle-draggable-id]') as HTMLElement

    expect(handle).toHaveAttribute('tabindex', '0')
    const description = document.getElementById(handle.getAttribute('aria-describedby') ?? '')
    expect(description).toHaveTextContent(/space bar/i)
    expect(document.querySelector('[aria-live]')).not.toBeNull()
  })
})

describe('TaskBoard drops', () => {
  it('sends both neighbours for a drop between two cards in the same column', async () => {
    const todo = [task('a', 'todo'), task('b', 'todo'), task('c', 'todo')]
    serve({ todo })
    setup()
    await screen.findByText('c')

    drop({ id: 'c', from: ['todo', 2], to: ['todo', 1] })

    await waitFor(() =>
      expect(taskApi.moveTask).toHaveBeenCalledWith('c', {
        status: 'todo',
        afterId: 'a',
        beforeId: 'b',
      }),
    )
  })

  it('sends both neighbours of the destination column for a cross-column drop', async () => {
    serve({
      todo: [task('a', 'todo')],
      in_progress: [task('x', 'in_progress'), task('y', 'in_progress')],
    })
    setup()
    await screen.findByText('y')

    drop({ id: 'a', from: ['todo', 0], to: ['in_progress', 1] })

    await waitFor(() =>
      expect(taskApi.moveTask).toHaveBeenCalledWith('a', {
        status: 'in_progress',
        afterId: 'x',
        beforeId: 'y',
      }),
    )
  })

  it('sends only the neighbour that exists at a real edge', async () => {
    serve({ todo: [task('a', 'todo')], done: [task('z', 'done')] })
    setup()
    await screen.findByText('z')

    drop({ id: 'a', from: ['todo', 0], to: ['done', 0] })

    await waitFor(() =>
      expect(taskApi.moveTask).toHaveBeenCalledWith('a', {
        status: 'done',
        afterId: undefined,
        beforeId: 'z',
      }),
    )
  })

  it('refetches after a move so a drop at the loaded end of a longer column is corrected', async () => {
    serve(
      { todo: [task('a', 'todo'), task('b', 'todo')], done: [task('z', 'done')] },
      { total: 5, limit: 2 },
    )
    setup()
    await screen.findByText('b')
    const before = vi.mocked(taskApi.listTasks).mock.calls.length

    drop({ id: 'z', from: ['done', 0], to: ['todo', 2] })

    await waitFor(() =>
      expect(taskApi.moveTask).toHaveBeenCalledWith('z', {
        status: 'todo',
        afterId: 'b',
        beforeId: undefined,
      }),
    )
    await waitFor(() =>
      expect(vi.mocked(taskApi.listTasks).mock.calls.length).toBeGreaterThan(before),
    )
  })

  it.each([
    ['is dropped outside a column', { destination: null }],
    ['is dropped where it started', { destination: { droppableId: 'todo', index: 0 } }],
  ])('does nothing when a card %s', async (_name, override) => {
    serve({ todo: [task('a', 'todo'), task('b', 'todo')] })
    setup()
    await screen.findByText('b')

    dnd.onDragEnd?.(
      {
        draggableId: 'a',
        type: 'DEFAULT',
        mode: 'FLUID',
        reason: 'DROP',
        source: { droppableId: 'todo', index: 0 },
        combine: null,
        ...override,
      },
      { announce: () => {} },
    )

    expect(taskApi.moveTask).not.toHaveBeenCalled()
  })

  it('ignores a drop once the cache has been cleared, so a previous user data is never used', async () => {
    serve({ todo: [task('a', 'todo'), task('b', 'todo')] })
    const { client } = setup()
    await screen.findByText('b')

    client.clear()
    drop({ id: 'a', from: ['todo', 0], to: ['todo', 1] })

    expect(taskApi.moveTask).not.toHaveBeenCalled()
  })

  it('shows the moved card in its new column at once', async () => {
    serve({ todo: [task('a', 'todo', 'Alpha')], done: [] })
    vi.mocked(taskApi.moveTask).mockReturnValue(new Promise(() => {}))
    setup()
    await screen.findByText('Alpha')

    drop({ id: 'a', from: ['todo', 0], to: ['done', 0] })

    const done = screen.getByRole('region', { name: 'Done' })
    expect(await within(done).findByText('Alpha')).toBeInTheDocument()
  })
})
