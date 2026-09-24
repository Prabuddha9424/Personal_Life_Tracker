import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { warmUpServer } from '@/shared/api/warmUp'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import { useAuthStore } from '../store/authStore'
import { SessionGate } from './SessionGate'

vi.mock('../api/authApi')
vi.mock('@/shared/api/warmUp')

const session = {
  accessToken: 'token',
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(warmUpServer).mockResolvedValue()
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null })
})

describe('SessionGate', () => {
  it('renders the app while the session is being restored', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)
    renderWithProviders(<SessionGate>App content</SessionGate>)

    expect(screen.getByText('App content')).toBeInTheDocument()
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'))
  })

  it('replaces the app with a message and a retry button when the server never came up', async () => {
    useAuthStore.setState({ status: 'unavailable' })
    vi.mocked(authApi.refresh).mockResolvedValue(session)
    renderWithProviders(<SessionGate>App content</SessionGate>)

    expect(screen.getByRole('alert')).toHaveTextContent('could not reach the server')
    expect(screen.queryByText('App content')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('App content')).toBeInTheDocument()
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('says to wait when the server refused because of too many attempts', async () => {
    useAuthStore.setState({ status: 'rateLimited' })
    vi.mocked(authApi.refresh).mockResolvedValue(session)
    renderWithProviders(<SessionGate>App content</SessionGate>)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a few minutes and try again.',
    )
    expect(screen.queryByText('App content')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('App content')).toBeInTheDocument()
  })
})
