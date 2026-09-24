import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import { useAuthStore } from '../store/authStore'
import { UserMenu } from './UserMenu'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
})

describe('UserMenu', () => {
  it('renders nothing when nobody is signed in', () => {
    useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null })

    const { container } = renderWithProviders(<UserMenu />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the name and logs out, clearing the session and every cached query', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'token',
      user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
    })
    queryClient.setQueryData(['tasks'], ['ada only'])
    vi.mocked(authApi.logout).mockResolvedValue()
    renderWithProviders(<UserMenu />)

    expect(screen.getByText('Ada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
    expect(authApi.logout).toHaveBeenCalledTimes(1)
  })
})
