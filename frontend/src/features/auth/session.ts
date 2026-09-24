import axios from 'axios'
import { configureAuth } from '@/shared/api/httpClient'
import { warmUpServer } from '@/shared/api/warmUp'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useAuthStore } from './store/authStore'
import type { SessionResponse, SessionUser } from './types'

let inFlight: Promise<boolean> | null = null
let bootstrapped: Promise<void> | null = null
/** Bumped whenever the session changes, so a slow refresh can tell its answer is out of date. */
let generation = 0

/** Records a new session (login, password change, refresh). */
export function startSession(session: SessionResponse): void {
  generation += 1
  useAuthStore.getState().setSession(session)
}

/** Signs out locally and drops every cached query, so the next user never sees this user's data. */
export function endSession(): void {
  generation += 1
  useAuthStore.getState().clear()
  queryClient.clear()
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (refresh tokens are single use). Resolves true when the caller may retry with the current
 * session. An answer that arrives after the session changed (logout, a newer login) is dropped.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runRefresh(): Promise<boolean> {
  const started = generation
  const stale = () => started !== generation
  const signedIn = () => useAuthStore.getState().status === 'authenticated'
  try {
    const session = await authApi.refresh()
    if (stale()) return signedIn()
    startSession(session)
    return true
  } catch (error) {
    if (stale()) return signedIn()
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      endSession()
    } else if (useAuthStore.getState().status === 'unknown') {
      // Server unreachable at start-up: show the login page rather than a spinner forever.
      useAuthStore.getState().clear()
    }
    return false
  }
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
