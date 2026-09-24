import axios from 'axios'
import { configureAuth } from '@/shared/api/httpClient'
import { warmUpServer } from '@/shared/api/warmUp'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useAuthStore } from './store/authStore'
import type { SessionUser } from './types'

let inFlight: Promise<boolean> | null = null
let bootstrapped: Promise<void> | null = null

/** Signs out locally and drops every cached query, so the next user never sees this user's data. */
export function endSession(): void {
  useAuthStore.getState().clear()
  queryClient.clear()
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (refresh tokens are single use). Resolves true when the session was renewed.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= authApi
    .refresh()
    .then(
      (session) => {
        useAuthStore.getState().setSession(session)
        return true
      },
      (error: unknown) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          endSession()
        } else if (useAuthStore.getState().status === 'unknown') {
          // Server unreachable at start-up: show the login page rather than a spinner forever.
          useAuthStore.getState().clear()
        }
        return false
      },
    )
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Wakes the backend if it is asleep, then tries to restore the session from the cookie. */
export function bootstrapSession(): Promise<void> {
  bootstrapped ??= warmUpServer().then(async () => {
    await refreshSession()
  })
  return bootstrapped
}

export async function logoutUser(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    // The user asked to leave. Local state is cleared below whatever the server said.
  } finally {
    endSession()
  }
}

export function updateSessionUser(partial: Partial<SessionUser>): void {
  const { user, setUser } = useAuthStore.getState()
  if (user) setUser({ ...user, ...partial })
}

/** Connects the shared HTTP client to the session. Call once at start-up. */
export function initAuth(): void {
  configureAuth({
    getToken: () => useAuthStore.getState().accessToken,
    onUnauthorized: refreshSession,
  })
}
