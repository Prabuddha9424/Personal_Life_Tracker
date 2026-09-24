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
})
