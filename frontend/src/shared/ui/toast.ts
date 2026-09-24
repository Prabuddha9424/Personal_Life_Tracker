import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: Toast[]
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export function pushToast(message: string, kind: ToastKind = 'info', durationMs = 5000): void {
  const id = nextId++
  useToastStore.setState((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), durationMs)
}
