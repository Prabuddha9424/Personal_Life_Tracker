import type { Scale } from 'chart.js'
import { describe, expect, it } from 'vitest'
import { axisMoney, moneyScales } from './chartOptions'
import type { ChartColors } from './useChartColors'

const colors: ChartColors = {
  text: '#111111',
  muted: '#222222',
  grid: '#333333',
  surface: '#444444',
  positive: '#555555',
  danger: '#666666',
  accent: '#777777',
  series: [],
}

function yTicks(currency: string) {
  const ticks = moneyScales(colors, currency).y.ticks
  const callback = (value: number) =>
    String(ticks.callback.call({} as Scale, value)).replace(/\s/g, ' ')
  return { precision: ticks.precision, callback }
}

describe('moneyScales', () => {
  it.each([
    ['USD', 2, [0, 0.01, 0.02, 0.03], ['$0.00', '$0.01', '$0.02', '$0.03']],
    ['JPY', 0, [0, 1, 2, 3], ['¥0', '¥1', '¥2', '¥3']],
    ['BHD', 3, [0, 0.001, 0.002, 0.003], ['BHD 0.000', 'BHD 0.001', 'BHD 0.002', 'BHD 0.003']],
  ])(
    'never asks for ticks finer than one %s minor unit, so tiny axes have distinct labels',
    (currency, digits, values, labels) => {
      const { precision, callback } = yTicks(currency)

      expect(precision).toBe(digits)
      expect(values.map(callback)).toEqual(labels)
      expect(new Set(labels).size).toBe(labels.length)
    },
  )

  it('draws the zero line stronger than the other grid lines', () => {
    const color = moneyScales(colors, 'USD').y.grid.color

    expect(color({ tick: { value: 0 } } as never)).toBe(colors.muted)
    expect(color({ tick: { value: 5 } } as never)).toBe(colors.grid)
  })
})

describe('axisMoney', () => {
  it('never renders negative zero', () => {
    expect(axisMoney(-0.0001, 'USD')).toBe('$0.00')
  })
})
