import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastHost } from './ToastHost'
import { useToastStore } from './toast'

describe('ToastHost', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders errors as alerts and other toasts inside the polite live region', () => {
    const { container } = render(<ToastHost />)
    const host = container.firstElementChild
    expect(host).toHaveAttribute('aria-live', 'polite')
    expect(host).toBeEmptyDOMElement()

    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 1, message: 'Saved', kind: 'success' },
          { id: 2, message: 'Could not save', kind: 'error' },
        ],
      })
    })

    expect(host).toHaveTextContent('Saved')
    expect(screen.getByText('Saved').closest('[aria-live="polite"]')).toBe(host)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  })
})
