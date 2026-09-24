import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, LoadingState } from './StateViews'

describe('state views', () => {
  it('LoadingState announces its label', () => {
    render(<LoadingState label="Loading tasks…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…')
  })

  it('EmptyState shows title, description and action', () => {
    render(
      <EmptyState
        title="No tasks yet"
        description="Add your first task."
        action={<button>Add</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument()
    expect(screen.getByText('Add your first task.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('ErrorState is an alert and offers a retry only when given a handler', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState message="Could not load" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ErrorState message="Could not load" />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
