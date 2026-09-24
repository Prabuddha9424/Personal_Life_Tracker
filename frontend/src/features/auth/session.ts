import axios from 'axios'
import { configureAuth } from '@/shared/api/httpClient'
import { useServerStatus } from '@/shared/api/serverStatus'
import { warmUpServer } from '@/shared/api/warmUp'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useAuthStore } from './store/authStore'
import { tokenOwnerId } from './tokenOwner'
import type { SessionResponse, SessionUser } from './types'

type RefreshOutcome = 'renewed' | 'rejected' | 'unavailable' | 'rateLimited'

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

/**
 * Tabs share one refresh cookie and refresh tokens are single use, so two tabs refreshing at
 * once would make the loser see a 401 for a session that is in fact fine. The Web Locks API makes
 * the second tab wait and then refresh with the cookie the first tab just rotated. Without it
 * (old browsers) the refresh simply runs unguarded.
 */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks: LockManager | undefined = navigator.locks
  return locks ? locks.request('auth-refresh', task) : task()
}

async function runRefresh(): Promise<RefreshOutcome> {
  // Captured before waiting for the lock: an answer that arrives after a logout or a newer login
  // is dropped however long the wait was.
  const started = generation
  const stale = () => started !== generation
  const current = (): RefreshOutcome =>
    useAuthStore.getState().status === 'authenticated' ? 'renewed' : 'rejected'
  try {
    const session = await withRefreshLock(() => authApi.refresh())
    if (stale()) return current()
    startSession(session)
    return 'renewed'
  } catch (error) {
    if (stale()) return current()
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      endSession()
      return 'rejected'
    }
    if (axios.isAxiosError(error) && error.response?.status === 429) return 'rateLimited'
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
 * Exchanges the refresh cookie for a new access token. Resolves true when the request that was
 * sent with `sentAuthorization` (and got a 401) may be sent again with the current session. An
 * answer that arrives after the session changed (logout, a newer login) is dropped, and a
 * network or gateway failure leaves an existing session untouched.
 *
 * The retry is tied to the user the request was SENT as, not to whoever is signed in when the 401
 * arrives: it is allowed only when that same user holds the renewed session. Otherwise a request
 * sent by one user would be replayed with the next user's token and land in their account. A
 * token with no readable owner is never retried.
 */
export async function refreshSession(sentAuthorization: string): Promise<boolean> {
  const owner = tokenOwnerId(sentAuthorization)
  if (owner === null) return false
  const outcome = await attemptRefresh()
  return outcome === 'renewed' && useAuthStore.getState().user?.id === owner
}

async function restoreSession(): Promise<void> {
  const { setWaking } = useServerStatus.getState()
  await warmUpServer()
  let outcome: RefreshOutcome = 'unavailable'
  for (let attempt = 1; attempt <= BOOTSTRAP_ATTEMPTS; attempt += 1) {
    outcome = await attemptRefresh()
    if (outcome !== 'unavailable') break
    // A valid cookie must not be mistaken for a logged-out user just because the server is cold.
    setWaking(true)
    if (attempt < BOOTSTRAP_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS))
    }
  }
  setWaking(false)
  // Whatever happened, never leave the app waiting on an answer that is not coming.
  if (useAuthStore.getState().status === 'unknown') {
    useAuthStore.setState({
      status: outcome === 'rejected' || outcome === 'renewed' ? 'anonymous' : outcome,
    })
  }
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
