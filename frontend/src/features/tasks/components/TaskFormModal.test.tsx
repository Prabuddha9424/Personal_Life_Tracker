import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as taskApi from '../api/taskApi'
import type { Task } from '../types'
import { TaskFormModal } from './TaskFormModal'

vi.mock('../api/taskApi')

const existing: Task = {
  id: 't1',
  title: 'Pay rent',
  description: 'before the 1st',
  status: 'in_progress',
  priority: 'high',
  dueDate: '2026-10-01',
  tags: ['home', 'bills'],
  position: 0,
  createdAt: '',
  updatedAt: '',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(taskApi.fetchTags).mockResolvedValue(['home', 'work'])
})

describe('TaskFormModal (create)', () => {
  it('validates before calling the API', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Enter a title')).toBeInTheDocument()
    expect(taskApi.createTask).not.toHaveBeenCalled()
  })

  it('links the validation message to the invalid field', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    const title = screen.getByLabelText('Title')
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAccessibleDescription('Enter a title')
  })

  it('rejects more than ten tags without calling the API', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.type(screen.getByLabelText('Tags'), 'a,b,c,d,e,f,g,h,i,j,k')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Use at most 10 tags')).toBeInTheDocument()
    expect(taskApi.createTask).not.toHaveBeenCalled()
  })

  it('disables the submit button while saving so it cannot be sent twice', async () => {
    let finish: (task: Task) => void = () => {}
    vi.mocked(taskApi.createTask).mockReturnValue(
      new Promise<Task>((resolve) => {
        finish = resolve
      }),
    )
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    const submit = await screen.findByRole('button', { name: 'Create task' })
    await waitFor(() => expect(submit).toBeDisabled())
    expect(submit).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(submit)
    fireEvent.submit(submit.closest('form') as HTMLFormElement)
    expect(taskApi.createTask).toHaveBeenCalledTimes(1)

    finish(existing)
    await waitFor(() => expect(submit).toBeEnabled())
  })

  it('creates a task in the column it was opened from and closes', async () => {
    vi.mocked(taskApi.createTask).mockResolvedValue(existing)
    const onClose = vi.fn()
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'in_progress' }} onClose={onClose} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'Call the dentist')
    await userEvent.selectOptions(screen.getByLabelText(/^priority/i), 'high')
    await userEvent.type(screen.getByLabelText('Due date'), '2026-10-05')
    await userEvent.type(screen.getByLabelText('Tags'), 'Health, home')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(taskApi.createTask).mock.calls[0]?.[0]).toEqual({
      title: 'Call the dentist',
      description: '',
      priority: 'high',
      dueDate: '2026-10-05',
      tags: ['health', 'home'],
      status: 'in_progress',
    })
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    vi.mocked(taskApi.createTask).mockRejectedValue(new Error('Network Error'))
    const onClose = vi.fn()
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={onClose} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network Error')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TaskFormModal (edit)', () => {
  it('fills the form from the task and saves only through update', async () => {
    vi.mocked(taskApi.updateTask).mockResolvedValue(existing)
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Pay rent')
    expect(screen.getByLabelText('Tags')).toHaveValue('home, bills')
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(taskApi.updateTask).toHaveBeenCalled())
    expect(vi.mocked(taskApi.updateTask).mock.calls[0]).toEqual([
      't1',
      {
        title: 'Pay rent',
        description: 'before the 1st',
        priority: 'high',
        dueDate: null,
        tags: ['home', 'bills'],
      },
    ])
    expect(taskApi.createTask).not.toHaveBeenCalled()
  })

  it('shows the server message inline when saving fails', async () => {
    vi.mocked(taskApi.updateTask).mockRejectedValue(new Error('Task not found'))
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Task not found')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a failed delete inline and keeps the dialog open', async () => {
    vi.mocked(taskApi.deleteTask).mockRejectedValue(new Error('Server down'))
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus to the safe choice when asking to confirm and back when cancelled', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(screen.getByRole('group', { name: 'Confirm deletion' })).toHaveTextContent(
      'Delete this task? This cannot be undone.',
    )
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Delete task' })).toHaveFocus()
  })

  it('asks for confirmation before deleting', async () => {
    vi.mocked(taskApi.deleteTask).mockResolvedValue()
    const onClose = vi.fn()
    renderWithProviders(<TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(taskApi.deleteTask).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(taskApi.deleteTask).mock.calls[0]?.[0]).toBe('t1')
  })
})

describe('TaskFormModal (focus)', () => {
  it('returns focus to the control that opened it when closed', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open form
          </button>
          {open && (
            <TaskFormModal
              mode={{ kind: 'create', status: 'todo' }}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    renderWithProviders(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'Open form' }))
    expect(screen.getByLabelText('Title')).toHaveFocus()
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open form' })).toHaveFocus()
  })
})
