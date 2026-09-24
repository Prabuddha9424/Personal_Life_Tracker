import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DashboardPage from './pages/DashboardPage'

describe('DashboardPage', () => {
  it('renders the app heading', () => {
    render(<DashboardPage />)
    expect(screen.getByRole('heading', { name: /personal life tracker/i })).toBeInTheDocument()
  })
})
