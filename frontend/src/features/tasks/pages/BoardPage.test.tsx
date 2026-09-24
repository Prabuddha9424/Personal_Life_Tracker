import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import type { Task, TaskPage, TaskStatus } from '../types'
import BoardPage from './BoardPage'

vi.mock('../api/taskApi')

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

const page = (items: Task[], total = items.length): TaskPage => ({
  items,
  page: 1,
  limit: 50,
  total,
})

function serve(byStatus: Partial<Record<TaskStatus, Task[]>>) {
  vi.mocked(taskApi.listTasks).mockImplementation(async (params) =>
    page(byStatus[params.status ?? 'todo'] ?? []),
  )
}

const column = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('BoardPage', () => {
  it('has a page heading', () => {
    serve({})
    renderWithProviders(<BoardPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument()
  })

  it('shows the three columns with their cards and counts', async () => {
    serve({
      todo: [task('1', 'todo', 'Buy milk'), task('2', 'todo', 'Call mum')],
      in_progress: [task('3', 'in_progress', 'Write report')],
      done: [],
    })

    renderWithProviders(<BoardPage />)

    expect(await within(column('To Do')).findByText('Buy milk')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('Call mum')).toBeInTheDocument()
    expect(within(column('In Progress')).getByText('Write report')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('2')).toBeInTheDocument()
  })

  it('announces the count with a unit, not as a bare number', async () => {
    serve({ todo: [task('1', 'todo'), task('2', 'todo')], done: [task('3', 'done')] })

    renderWithProviders(<BoardPage />)

    expect(await within(column('To Do')).findByText('2 tasks')).toBeInTheDocument()
    expect(within(column('Done')).getByText('1 task')).toBeInTheDocument()
  })

  it('says a column is updating, and locks its cards, while a new filter loads', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
      if (params.tag === 'work') return new Promise<TaskPage>(() => {})
      return page(params.status === 'todo' ? [task('1', 'todo', 'Buy milk')] : [])
    })
    renderWithProviders(<BoardPage />)
    await within(column('To Do')).findByText('Buy milk')
    expect(within(column('To Do')).queryByText('Updating…')).not.toBeInTheDocument()
    expect(
      within(column('To Do')).getByRole('button', { name: 'Move Buy milk' }),
    ).toBeInTheDocument()

    await screen.findByRole('option', { name: 'work' })
    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'work')

    expect(await within(column('To Do')).findByRole('status')).toHaveTextContent('Updating…')
    expect(within(column('To Do')).getByText('Buy milk')).toBeInTheDocument()
    expect(within(column('To Do')).queryByRole('button', { name: 'Move Buy milk' })).toBeNull()
  })

  it('says so when a column is empty', async () => {
    serve({ todo: [task('1', 'todo')] })

    renderWithProviders(<BoardPage />)

    expect(await within(column('Done')).findByText('Nothing here yet')).toBeInTheDocument()
  })

  it('shows a loading state while a column loads', () => {
    vi.mocked(taskApi.listTasks).mockReturnValue(new Promise(() => {}))

    renderWithProviders(<BoardPage />)

    expect(within(column('To Do')).getByRole('status')).toHaveTextContent('Loading')
  })

  it('shows an error with a retry for a column that failed, without breaking the others', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
      if (params.status === 'done') throw new Error('boom')
      return page([task('1', params.status ?? 'todo', `card ${params.status}`)])
    })

    renderWithProviders(<BoardPage />)

    expect(await within(column('Done')).findByRole('alert')).toBeInTheDocument()
    expect(within(column('To Do')).getByText('card todo')).toBeInTheDocument()
    expect(within(column('Done')).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('retries only the failed column', async () => {
    let doneCalls = 0
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
      if (params.status === 'done') {
        doneCalls += 1
        if (doneCalls === 1) throw new Error('boom')
        return page([task('9', 'done', 'Finally')])
      }
      return page([])
    })
    renderWithProviders(<BoardPage />)

    await userEvent.click(await within(column('Done')).findByRole('button', { name: 'Try again' }))

    expect(await within(column('Done')).findByText('Finally')).toBeInTheDocument()
  })

  it('offers to load more when a column has further pages, and asks for the next page', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) =>
      params.status === 'todo'
        ? { items: [task('1', 'todo')], page: params.page ?? 1, limit: 1, total: 2 }
        : page([]),
    )
    renderWithProviders(<BoardPage />)

    await userEvent.click(await within(column('To Do')).findByRole('button', { name: 'Load more' }))

    const todoPages = vi
      .mocked(taskApi.listTasks)
      .mock.calls.filter(([params]) => params.status === 'todo')
      .map(([params]) => params.page)
    expect(todoPages).toContain(2)
  })

  it('shows a loading state on Load more while the next page loads', async () => {
    vi.mocked(taskApi.listTasks).mockImplementation(async (params) => {
      if (params.status !== 'todo') return page([])
      if (params.page === 2) return new Promise<TaskPage>(() => {})
      return { items: [task('1', 'todo')], page: 1, limit: 1, total: 2 }
    })
    renderWithProviders(<BoardPage />)

    await userEvent.click(await within(column('To Do')).findByRole('button', { name: 'Load more' }))

    expect(within(column('To Do')).getByRole('button', { name: 'Load more' })).toBeDisabled()
  })

  it('filters every column by the chosen tag', async () => {
    serve({ todo: [task('1', 'todo')] })
    renderWithProviders(<BoardPage />)

    await screen.findByRole('option', { name: 'work' })
    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'work')

    await vi.waitFor(() => {
      const withTag = vi
        .mocked(taskApi.listTasks)
        .mock.calls.filter(([params]) => params.tag === 'work')
      expect([...new Set(withTag.map(([params]) => params.status))].sort()).toEqual([
        'done',
        'in_progress',
        'todo',
      ])
    })
  })

  it('searches every column by title', async () => {
    serve({})
    renderWithProviders(<BoardPage />)

    await userEvent.type(screen.getByLabelText('Search tasks'), 'milk{Enter}')

    await vi.waitFor(() =>
      expect(vi.mocked(taskApi.listTasks).mock.calls.some(([params]) => params.q === 'milk')).toBe(
        true,
      ),
    )
  })

  it('opens the new-task dialog for the column whose plus button was used', async () => {
    serve({})
    renderWithProviders(<BoardPage />)

    await userEvent.click(
      within(column('In Progress')).getByRole('button', { name: 'Add task to In Progress' }),
    )
    await userEvent.type(screen.getByLabelText('Title'), 'Ship it')
    vi.mocked(taskApi.createTask).mockResolvedValue(task('9', 'in_progress', 'Ship it'))
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() => expect(taskApi.createTask).toHaveBeenCalled())
    expect(vi.mocked(taskApi.createTask).mock.calls[0]?.[0]).toMatchObject({
      title: 'Ship it',
      status: 'in_progress',
    })
  })

  it('opens a card for editing when it is clicked', async () => {
    serve({ todo: [task('1', 'todo', 'Buy milk')] })
    renderWithProviders(<BoardPage />)

    await userEvent.click(await screen.findByText('Buy milk'))

    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Buy milk')
  })
})
