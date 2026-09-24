import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('is an accessible dialog with a title', () => {
    render(
      <Modal title="New task" onClose={() => {}}>
        <input aria-label="Title" />
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'New task' })).toHaveAttribute('aria-modal', 'true')
  })

  it('moves focus to the first field and gives it back on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { unmount } = render(
      <Modal title="New task" onClose={() => {}}>
        <input aria-label="Title" />
      </Modal>,
    )
    expect(screen.getByLabelText('Title')).toHaveFocus()

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closes on Escape and on a backdrop click, but not on a click inside', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="New task" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside the dialog', async () => {
    render(
      <Modal title="New task" onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    )
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()

    await userEvent.tab()

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
  })
})
