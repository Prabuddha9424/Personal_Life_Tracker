import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastHost } from './ToastHost'
import { useToastStore } from './toast'

describe('ToastHost', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders errors as alerts and other toasts as status messages', () => {
    render(<ToastHost />)

    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 1, message: 'Saved', kind: 'success' },
          { id: 2, message: 'Could not save', kind: 'error' },
        ],
      })
    })

    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  })
})
