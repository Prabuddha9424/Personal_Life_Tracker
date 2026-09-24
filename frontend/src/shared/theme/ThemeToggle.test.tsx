import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from './ThemeToggle'
import { useThemeStore } from './themeStore'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useThemeStore.getState().setTheme('dark')
  })

  it('offers the opposite theme and switches on click', async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    expect(useThemeStore.getState().theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })
})
