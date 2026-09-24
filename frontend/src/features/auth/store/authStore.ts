import { create } from 'zustand'
import type { SessionResponse, SessionUser } from '../types'

/**
 * `unavailable` and `rateLimited`: start-up could not learn whether a session exists, because the
 * server was unreachable or refused the request for too many attempts.
 */
type Status = 'unknown' | 'authenticated' | 'anonymous' | 'unavailable' | 'rateLimited'

interface AuthState {
  status: Status
  /** In memory only. Never written to localStorage, sessionStorage or a readable cookie. */
  accessToken: string | null
  user: SessionUser | null
  setSession: (session: SessionResponse) => void
  setUser: (user: SessionUser) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ status: 'authenticated', accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}))
