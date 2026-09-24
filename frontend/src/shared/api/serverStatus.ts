import { create } from 'zustand'

interface ServerStatusState {
  waking: boolean
  setWaking: (waking: boolean) => void
}

export const useServerStatus = create<ServerStatusState>((set) => ({
  waking: false,
  setWaking: (waking) => set({ waking }),
}))
