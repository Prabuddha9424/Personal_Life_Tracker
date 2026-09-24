import { create } from 'zustand'
import type { SessionResponse, SessionUser } from '../types'

/** `unavailable`: start-up could not reach the server, so it is unknown whether a session exists. */
type Status = 'unknown' | 'authenticated' | 'anonymous' | 'unavailable'

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
