import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { useAuthStore } from '../store/authStore'
import LoginPage from './LoginPage'

vi.mock('../api/authApi')

const session = {
  accessToken: 'token',
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
}

function apiError(status: number, message: string) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: { message },
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>Dashboard home</p>} />
    </Routes>,
    { route: '/login' },
  )
}

function BoardProbe() {
  const location = useLocation()
  return <p>Board at {location.pathname + location.search + location.hash}</p>
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null })
})

describe('LoginPage', () => {
  it('shows validation errors and does not call the API for an empty form', async () => {
    renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('logs in, stores the session in memory and goes to the dashboard', async () => {
    vi.mocked(authApi.login).mockResolvedValue(session)
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByText('Dashboard home')).toBeInTheDocument()
    expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
      password: 'a-long-passphrase',
    })
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: 'token' })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('returns to the exact deep link, query string and hash included, after logging in', async () => {
    vi.mocked(authApi.login).mockResolvedValue(session)
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/board" element={<BoardProbe />} />
        </Route>
      </Routes>,
      { route: '/board?filter=done#top' },
    )

    await fillAndSubmit()

    expect(await screen.findByText('Board at /board?filter=done#top')).toBeInTheDocument()
  })

  it('drops cached data from a previous user on the same browser', async () => {
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.login).mockResolvedValue(session)
    renderLogin()

    await fillAndSubmit()

    await screen.findByText('Dashboard home')
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })

  it('shows the server message when the credentials are wrong', async () => {
    vi.mocked(authApi.login).mockRejectedValue(apiError(401, 'Invalid email or password'))
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('offers to resend the verification email when the account is unverified', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiError(403, 'Please verify your email before logging in'),
    )
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderLogin()

    await fillAndSubmit()
    await userEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }))

    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })

  it('shows why resending the verification email failed', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiError(403, 'Please verify your email before logging in'),
    )
    vi.mocked(authApi.resendVerification).mockRejectedValue(apiError(503, 'unavailable'))
    renderLogin()

    await fillAndSubmit()
    await userEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }))

    expect(
      await screen.findByText('The server is waking up. Please try again in a moment.'),
    ).toBeInTheDocument()
  })

  it('links to registration and password reset', () => {
    renderLogin()

    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    )
  })
})
