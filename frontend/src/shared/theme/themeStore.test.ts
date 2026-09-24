import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from './themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.getState().setTheme('dark')
  })

  it('applies the theme to the document and persists it', () => {
    useThemeStore.getState().setTheme('light')

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('toggles between dark and light', () => {
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('still switches when storage throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(() => useThemeStore.getState().setTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')

    setItem.mockRestore()
  })
})
