import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from './useReducedMotion'

type Listener = () => void

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const media = {
    matches,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }
  window.matchMedia = vi.fn().mockReturnValue(media)
  return {
    change(next: boolean) {
      media.matches = next
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useReducedMotion', () => {
  it('is false where matchMedia does not exist', () => {
    const { result } = renderHook(() => useReducedMotion())

    expect(result.current).toBe(false)
  })

  it('reflects the preference and follows changes', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')

    act(() => media.change(true))

    expect(result.current).toBe(true)
  })

  it('stops listening on unmount', () => {
    const media = stubMatchMedia(true)
    const { unmount } = renderHook(() => useReducedMotion())
    expect(media.listenerCount()).toBe(1)

    unmount()

    expect(media.listenerCount()).toBe(0)
  })
})
