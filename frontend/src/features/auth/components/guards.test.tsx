import { screen } from '@testing-library/react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { useAuthStore } from '../store/authStore'
import { GuestRoute } from './GuestRoute'
import { ProtectedRoute } from './ProtectedRoute'

function LoginProbe() {
  const location = useLocation()
  return <p>Login page (from {String((location.state as { from?: string } | null)?.from)})</p>
}

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/board" element={<p>Board</p>} />
      </Route>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginProbe />} />
      </Route>
      <Route path="/" element={<p>Home</p>} />
      <Route
        path="/from-elsewhere"
        element={<Navigate to="/login" state={{ from: '//evil.example' }} />}
      />
      <Route
        path="/from-board"
        element={<Navigate to="/login" state={{ from: '/board?tab=1#top' }} />}
      />
    </Routes>,
    { route },
  )
}

const user = { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' }

beforeEach(() => {
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null })
})

describe('ProtectedRoute', () => {
  it('waits while the session is being restored', () => {
    renderApp('/board')

    expect(screen.getByRole('status')).toHaveTextContent('Loading your account')
    expect(screen.queryByText('Board')).not.toBeInTheDocument()
  })

  it('sends anonymous visitors to log in and remembers where they were going', () => {
    useAuthStore.setState({ status: 'anonymous' })

    renderApp('/board')

    expect(screen.getByText('Login page (from /board)')).toBeInTheDocument()
  })

  it('remembers the query string and hash of a deep link', () => {
    useAuthStore.setState({ status: 'anonymous' })

    renderApp('/board?filter=done#top')

    expect(screen.getByText('Login page (from /board?filter=done#top)')).toBeInTheDocument()
  })

  it('never shows the page while it is unknown whether a session exists', () => {
    useAuthStore.setState({ status: 'unavailable' })

    renderApp('/board')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Board')).not.toBeInTheDocument()
  })

  it('shows the page to a signed-in user', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/board')

    expect(screen.getByText('Board')).toBeInTheDocument()
  })
})

describe('GuestRoute', () => {
  it('sends a signed-in user away from the login page', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/login')

    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('sends a signed-in user on to the page they were heading to', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/from-board')

    expect(screen.getByText('Board')).toBeInTheDocument()
  })

  it('ignores an unsafe origin and goes home instead', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/from-elsewhere')

    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('never shows the login form while it is unknown whether a session exists', () => {
    useAuthStore.setState({ status: 'unavailable' })

    renderApp('/login')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/Login page/)).not.toBeInTheDocument()
  })

  it('waits while the session is unknown, then shows the login page to anonymous visitors', () => {
    const { unmount } = renderApp('/login')
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()

    useAuthStore.setState({ status: 'anonymous' })
    renderApp('/login')
    expect(screen.getByText(/Login page/)).toBeInTheDocument()
  })
})
