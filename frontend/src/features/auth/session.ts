import axios from 'axios'
import { configureAuth } from '@/shared/api/httpClient'
import { useServerStatus } from '@/shared/api/serverStatus'
import { warmUpServer } from '@/shared/api/warmUp'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useAuthStore } from './store/authStore'
import type { SessionResponse, SessionUser } from './types'

type RefreshOutcome = 'renewed' | 'rejected' | 'unavailable'

const BOOTSTRAP_ATTEMPTS = 4
const BOOTSTRAP_RETRY_DELAY_MS = 5000

let inFlight: Promise<RefreshOutcome> | null = null
let bootstrapped: Promise<void> | null = null
/** Bumped whenever the session changes, so a slow refresh can tell its answer is out of date. */
let generation = 0

/** Records a new session (login, password change, refresh). */
export function startSession(session: SessionResponse): void {
  generation += 1
  useAuthStore.getState().setSession(session)
}

/** Signs out locally and drops every cached query, so the next user never sees this user's data. */
function endSession(): void {
  generation += 1
  useAuthStore.getState().clear()
  queryClient.clear()
}

async function runRefresh(): Promise<RefreshOutcome> {
  const started = generation
  const stale = () => started !== generation
  const current = (): RefreshOutcome =>
    useAuthStore.getState().status === 'authenticated' ? 'renewed' : 'rejected'
  try {
    const session = await authApi.refresh()
    if (stale()) return current()
    startSession(session)
    return 'renewed'
  } catch (error) {
    if (stale()) return current()
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      endSession()
      return 'rejected'
    }
    return 'unavailable'
  }
}

/** Concurrent callers share one request, because refresh tokens are single use. */
function attemptRefresh(): Promise<RefreshOutcome> {
  inFlight ??= runRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}

/**
 * Exchanges the refresh cookie for a new access token. Resolves true when the caller may retry
 * with the current session. An answer that arrives after the session changed (logout, a newer
 * login) is dropped, and a network or gateway failure leaves an existing session untouched.
 */
export async function refreshSession(): Promise<boolean> {
  return (await attemptRefresh()) === 'renewed'
}

async function restoreSession(): Promise<void> {
  const { setWaking } = useServerStatus.getState()
  await warmUpServer()
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    if ((await attemptRefresh()) !== 'unavailable') {
      setWaking(false)
      return
    }
    // A valid cookie must not be mistaken for a logged-out user just because the server is cold.
    setWaking(true)
    if (attempt < BOOTSTRAP_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS))
    }
  }
  setWaking(false)
  if (useAuthStore.getState().status === 'unknown') useAuthStore.setState({ status: 'unavailable' })
}

/** Wakes the backend if it is asleep, then restores the session from the cookie. Runs once. */
export function bootstrapSession(): Promise<void> {
  bootstrapped ??= restoreSession()
  return bootstrapped
}

/** Starts the restore over, for the "Try again" button after the server stayed unreachable. */
export function retryBootstrap(): Promise<void> {
  bootstrapped = null
  useAuthStore.setState({ status: 'unknown' })
  return bootstrapSession()
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
