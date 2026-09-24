import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushToast, useToastStore } from './toast'

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a toast and removes it after its duration', () => {
    pushToast('Saved', 'success', 3000)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(2999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps toasts independent', () => {
    pushToast('One', 'info', 1000)
    pushToast('Two', 'info', 5000)

    vi.advanceTimersByTime(1000)

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Two'])
  })
})
