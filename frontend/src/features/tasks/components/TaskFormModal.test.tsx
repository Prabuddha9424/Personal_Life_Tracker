import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
    const form = screen
      .getByRole('button', { name: 'Create task' })
      .closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(taskApi.createTask).toHaveBeenCalled())
    await act(async () => {})

    expect(taskApi.createTask).toHaveBeenCalledTimes(1)
    const submit = screen.getByRole('button', { name: 'Create task' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-busy', 'true')
    fireEvent.submit(form)
    await act(async () => {})
    expect(taskApi.createTask).toHaveBeenCalledTimes(1)

    finish(existing)
    await waitFor(() => expect(submit).toBeEnabled())
  })

  it('clears a failed create when the next submit fails validation', async () => {
    vi.mocked(taskApi.createTask).mockRejectedValue(new Error('Network Error'))
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={() => {}} />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Network Error')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Enter a title')).toBeInTheDocument()
    expect(screen.queryByText('Network Error')).not.toBeInTheDocument()
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

  it('drops a failed delete message once the user keeps the task', async () => {
    vi.mocked(taskApi.deleteTask).mockRejectedValue(new Error('Server down'))
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    expect(await screen.findByText('Server down')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(screen.queryByText('Server down')).not.toBeInTheDocument()
  })

  it('describes the confirmation group by its question', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))

    expect(screen.getByRole('group', { name: 'Confirm deletion' })).toHaveAccessibleDescription(
      'Delete this task? This cannot be undone.',
    )
  })

  it('locks saving while the delete confirmation is showing or running', async () => {
    let finish: () => void = () => {}
    vi.mocked(taskApi.deleteTask).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(screen.getByLabelText('Title')).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(taskApi.deleteTask).toHaveBeenCalled())
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save changes' }).closest('form') as HTMLFormElement,
    )
    await act(async () => {})
    expect(taskApi.updateTask).not.toHaveBeenCalled()

    finish()
    await act(async () => {})
  })

  it('re-enables the form when the user keeps the task', async () => {
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'edit', task: existing }} onClose={() => {}} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.getByLabelText('Title')).toBeEnabled()
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

describe('TaskFormModal (closing while a save is running)', () => {
  async function submitPending() {
    const settle = {
      resolve: (task: Task): void => void task,
      reject: (error: Error): void => void error,
    }
    vi.mocked(taskApi.createTask).mockReturnValue(
      new Promise<Task>((resolve, reject) => {
        settle.resolve = resolve
        settle.reject = reject
      }),
    )
    const onClose = vi.fn()
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={onClose} />,
    )
    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await vi.waitFor(() => expect(taskApi.createTask).toHaveBeenCalled())
    return { onClose, settle }
  }

  it('ignores Escape, the backdrop and the close button while the request is pending', async () => {
    const { onClose } = await submitPending()

    await userEvent.keyboard('{Escape}')
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('still shows the inline error when the request fails after Escape was pressed', async () => {
    const { onClose, settle } = await submitPending()

    await userEvent.keyboard('{Escape}')
    await act(async () => settle.reject(new Error('Network Error')))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network Error')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the request succeeds', async () => {
    const { onClose, settle } = await submitPending()

    await userEvent.keyboard('{Escape}')
    await act(async () => settle.resolve(existing))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('lets Escape close the dialog again once the request has failed', async () => {
    const { onClose, settle } = await submitPending()

    await act(async () => settle.reject(new Error('Network Error')))
    await screen.findByRole('alert')
    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape as usual when nothing is pending', async () => {
    const onClose = vi.fn()
    renderWithProviders(
      <TaskFormModal mode={{ kind: 'create', status: 'todo' }} onClose={onClose} />,
    )

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
