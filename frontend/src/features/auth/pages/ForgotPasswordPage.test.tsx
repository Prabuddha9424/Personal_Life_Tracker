import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import ForgotPasswordPage from './ForgotPasswordPage'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ForgotPasswordPage', () => {
  it('validates the email first', async () => {
    renderWithProviders(<ForgotPasswordPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(authApi.forgotPassword).not.toHaveBeenCalled()
  })

  it('shows the same confirmation without saying whether the account exists', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue()
    renderWithProviders(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText('Email'), 'anyone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(
      await screen.findByText('If an account exists for that email, a reset link is on its way.'),
    ).toBeInTheDocument()
    expect(vi.mocked(authApi.forgotPassword).mock.calls[0]?.[0]).toEqual({
      email: 'anyone@example.com',
    })
  })
})
