import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/shared/theme/themeStore'
import { useChartColors } from './useChartColors'

const TOKENS = {
  '--text': '#111111',
  '--text-muted': '#222222',
  '--border': '#333333',
  '--surface': '#444444',
  '--positive': '#555555',
  '--danger': '#666666',
  '--accent': '#777777',
  '--chart-1': '#a1a1a1',
  '--chart-2': '#a2a2a2',
  '--chart-3': '#a3a3a3',
  '--chart-4': '#a4a4a4',
  '--chart-5': '#a5a5a5',
  '--chart-6': '#a6a6a6',
}

function setTokens(tokens: Record<string, string>) {
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, ` ${value} `)
  }
}

afterEach(() => {
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name)
  act(() => useThemeStore.getState().setTheme('dark'))
})

describe('useChartColors', () => {
  it('reads the trimmed design tokens', () => {
    setTokens(TOKENS)

    const { result } = renderHook(() => useChartColors())

    expect(result.current).toEqual({
      text: '#111111',
      muted: '#222222',
      grid: '#333333',
      surface: '#444444',
      positive: '#555555',
      danger: '#666666',
      accent: '#777777',
      series: ['#a1a1a1', '#a2a2a2', '#a3a3a3', '#a4a4a4', '#a5a5a5', '#a6a6a6'],
    })
  })

  it('recomputes when the theme changes and keeps the value otherwise', () => {
    setTokens(TOKENS)
    const { result, rerender } = renderHook(() => useChartColors())
    const first = result.current

    rerender()
    expect(result.current).toBe(first)

    setTokens({ '--text': '#eeeeee', '--chart-1': '#b1b1b1' })
    act(() => useThemeStore.getState().setTheme('light'))

    expect(result.current.text).toBe('#eeeeee')
    expect(result.current.series[0]).toBe('#b1b1b1')
  })
})
