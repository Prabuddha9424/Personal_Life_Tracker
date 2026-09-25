import type { ChartOptions } from 'chart.js'
import { formatMinorUnits, minorUnitDigits } from '@/shared/lib/money'
import type { ChartColors } from './useChartColors'

/**
 * A money label for a value on a chart axis. Chart.js hands ticks over in major units, so this
 * rounds back to integer minor units and formats them like every other amount. Display only.
 */
export function axisMoney(value: number, currency: string): string {
  const minor = Math.round(value * 10 ** minorUnitDigits(currency)) || 0
  return formatMinorUnits(minor, currency)
}

/** Options every chart shares: fill its box, and skip animation when the user asks for less motion. */
export function baseOptions(reducedMotion: boolean) {
  return {
    maintainAspectRatio: false,
    ...(reducedMotion ? { animation: false as const } : {}),
  }
}

/** Tooltips follow the theme; the browser default is a fixed dark box. */
export function tooltipColors(colors: ChartColors) {
  return {
    backgroundColor: colors.surface,
    titleColor: colors.text,
    bodyColor: colors.text,
    borderColor: colors.muted,
    borderWidth: 1,
  }
}

/** A category x-axis and a money y-axis. The zero line is drawn stronger than the other grid lines. */
export function moneyScales(colors: ChartColors, currency: string) {
  return {
    x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
    y: {
      ticks: {
        color: colors.muted,
        // Ticks finer than one minor unit would round to repeated labels ($0.005 and $0.01).
        precision: minorUnitDigits(currency),
        callback: (value) => axisMoney(Number(value), currency),
      },
      grid: { color: (context) => (context.tick.value === 0 ? colors.muted : colors.grid) },
    },
  } satisfies ChartOptions<'bar'>['scales']
}
