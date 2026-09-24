import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { StrictMode } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import VerifyEmailPage from './VerifyEmailPage'

vi.mock('../api/authApi')

function LocationProbe() {
  return <output aria-label="search">{useLocation().search}</output>
}

function renderVerify(route: string) {
  return renderWithProviders(
    <StrictMode>
      <Routes>
        <Route
          path="/verify-email"
          element={
            <>
              <VerifyEmailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </StrictMode>,
    { route },
  )
}

const TOKEN = 'a'.repeat(64)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('VerifyEmailPage', () => {
  it('verifies the token once, even under StrictMode, and removes it from the address bar', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue()

    renderVerify(`/verify-email?token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(authApi.verifyEmail).mock.calls[0]?.[0]).toEqual({ token: TOKEN })
    expect(screen.getByLabelText('search').textContent).toBe('')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('explains an invalid or expired link and offers a new one', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 400,
        statusText: '',
        data: { message: 'Invalid or expired token' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )

    renderVerify(`/verify-email?token=${TOKEN}`)

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('search').textContent).toBe('')
  })

  it('asks the user to check their inbox when there is no token, without calling the API', () => {
    renderVerify('/verify-email')

    expect(screen.getByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(authApi.verifyEmail).not.toHaveBeenCalled()
  })

  it('resends a link and confirms without saying whether the account exists', async () => {
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderVerify('/verify-email')

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))

    expect(await screen.findByText(/new link is on its way/i)).toBeInTheDocument()
    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })
})
