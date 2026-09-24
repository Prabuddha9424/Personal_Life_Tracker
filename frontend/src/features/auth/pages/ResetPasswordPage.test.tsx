import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import ResetPasswordPage from './ResetPasswordPage'

vi.mock('../api/authApi')

const TOKEN = 'b'.repeat(64)

function LocationProbe() {
  return <output aria-label="search">{useLocation().search}</output>
}

function renderReset(route: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/reset-password"
        element={
          <>
            <ResetPasswordPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { route },
  )
}

function badRequest(data: unknown) {
  return new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
    status: 400,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

async function fill(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('New password'), password)
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ResetPasswordPage', () => {
  it('points to the forgot-password page when the link has no token', () => {
    renderReset('/reset-password')

    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('removes the token from the address bar', () => {
    renderReset(`/reset-password?token=${TOKEN}`)

    expect(screen.getByLabelText('search').textContent).toBe('')
  })

  it('rejects mismatched passwords without calling the API', async () => {
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-different-one')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(authApi.resetPassword).not.toHaveBeenCalled()
  })

  it('changes the password with the captured token and links to log in', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue()
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-long-passphrase')

    expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument()
    expect(vi.mocked(authApi.resetPassword).mock.calls[0]?.[0]).toEqual({
      token: TOKEN,
      password: 'a-long-passphrase',
    })
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('explains an expired link and offers a new one', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue(
      badRequest({ message: 'Invalid or expired token' }),
    )
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-long-passphrase')

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument()
  })

  it('shows why a rejected password was refused and keeps the form so the link can be retried', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValueOnce(
      badRequest({
        message: 'Validation failed',
        errors: [{ path: 'password', message: 'That password is too common' }],
      }),
    )
    vi.mocked(authApi.resetPassword).mockResolvedValueOnce()
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('password123456', 'password123456')

    expect(await screen.findByText('That password is too common')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInvalid()
    expect(screen.queryByText(/invalid or has expired/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.clear(screen.getByLabelText('Confirm new password'))
    await fill('a-long-passphrase', 'a-long-passphrase')

    expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument()
    expect(vi.mocked(authApi.resetPassword).mock.calls[1]?.[0]).toEqual({
      token: TOKEN,
      password: 'a-long-passphrase',
    })
  })
})
