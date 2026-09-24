import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { AppShell } from './AppShell'

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>Home content</p>} />
      </Route>
    </Routes>,
  )
}

describe('AppShell', () => {
  it('shows the navigation, marks the current page and renders the route content', () => {
    renderShell()

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument()
  })

  it('opens and closes the navigation drawer on small screens', async () => {
    renderShell()
    const sidebar = screen.getByLabelText('Primary')
    expect(sidebar).not.toHaveClass('is-open')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(sidebar).toHaveClass('is-open')

    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(sidebar).not.toHaveClass('is-open')
  })

  it('keeps aria-expanded and the accessible name in step with the drawer', async () => {
    renderShell()
    const button = screen.getByRole('button', { name: 'Open navigation' })
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(button)
    expect(button).toHaveAccessibleName('Close navigation')
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(button)
    expect(button).toHaveAccessibleName('Open navigation')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves focus to the first nav link when the drawer opens', async () => {
    renderShell()

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the menu button', async () => {
    renderShell()
    const sidebar = screen.getByLabelText('Primary')
    const button = screen.getByRole('button', { name: 'Open navigation' })
    await userEvent.click(button)
    expect(sidebar).toHaveClass('is-open')

    await userEvent.keyboard('{Escape}')

    expect(sidebar).not.toHaveClass('is-open')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })

  it('closes when the scrim is clicked and hides the scrim from assistive tech', async () => {
    const { container } = renderShell()
    const sidebar = screen.getByLabelText('Primary')
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const scrim = container.querySelector('.shell__scrim')
    expect(scrim).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(scrim as Element)

    expect(sidebar).not.toHaveClass('is-open')
  })
})
