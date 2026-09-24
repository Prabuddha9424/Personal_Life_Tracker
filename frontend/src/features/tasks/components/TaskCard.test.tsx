import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { todayIso } from '@/shared/lib/dates'
import type { Task } from '../types'
import { TaskCard } from './TaskCard'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '1',
    title: 'Pay rent',
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('TaskCard', () => {
  it('shows the title, priority and tags', () => {
    render(<TaskCard task={task({ priority: 'high', tags: ['home', 'bills'] })} />)

    expect(screen.getByText('Pay rent')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.getByText('bills')).toBeInTheDocument()
  })

  it('shows the due date without a badge when it is in the future', () => {
    render(<TaskCard task={task({ dueDate: '2999-12-31' })} />)

    expect(screen.getByText(/Dec 31, 2999|31 Dec 2999/)).toBeInTheDocument()
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('badges a task whose due date has passed', () => {
    render(<TaskCard task={task({ dueDate: '2000-01-01' })} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('does not badge a finished task even when its due date has passed', () => {
    render(<TaskCard task={task({ dueDate: '2000-01-01', status: 'done' })} />)

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('omits the due line when there is no date', () => {
    render(<TaskCard task={task()} />)

    expect(screen.queryByText(/Due/)).not.toBeInTheDocument()
  })

  it('does not badge a task due today', () => {
    render(<TaskCard task={task({ dueDate: todayIso() })} />)

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  })

  it('states the priority in words for screen readers, not only by colour', () => {
    render(<TaskCard task={task({ priority: 'low' })} />)

    expect(screen.getByText('Priority:')).toHaveClass('visually-hidden')
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('announces the overdue state in text next to the due date', () => {
    render(<TaskCard task={task({ dueDate: '2000-01-01' })} />)

    expect(screen.getByText('Overdue')).toBeVisible()
    expect(screen.getByText(/^Due/)).toBeInTheDocument()
  })

  it('has no edit button unless a handler is given', () => {
    render(<TaskCard task={task()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a keyboard-operable edit button named after the task', async () => {
    const onEdit = vi.fn()
    const pay = task({ title: 'Pay rent' })
    render(<TaskCard task={pay} onEdit={onEdit} />)

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Edit task: Pay rent' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(onEdit).toHaveBeenCalledWith(pay)
  })
})
