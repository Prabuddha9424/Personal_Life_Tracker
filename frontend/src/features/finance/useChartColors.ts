import { useMemo } from 'react'
import { useThemeStore } from '@/shared/theme/themeStore'

export interface ChartColors {
  text: string
  muted: string
  grid: string
  surface: string
  positive: string
  danger: string
  accent: string
  series: string[]
}

function readColors(): ChartColors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    text: read('--text'),
    muted: read('--text-muted'),
    grid: read('--border'),
    surface: read('--surface'),
    positive: read('--positive'),
    danger: read('--danger'),
    accent: read('--accent'),
    series: [1, 2, 3, 4, 5, 6].map((index) => read(`--chart-${index}`)),
  }
}

/** Chart colours come from the CSS variables of the active theme, so charts follow theme changes. */
export function useChartColors(): ChartColors {
  const theme = useThemeStore((state) => state.theme)
  // The theme is the trigger, not an input: it decides which CSS variables apply.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readColors(), [theme])
}
