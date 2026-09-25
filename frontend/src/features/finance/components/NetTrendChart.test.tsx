import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChartData, ChartOptions } from 'chart.js'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/shared/theme/themeStore'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { NetTrendChart } from './NetTrendChart'

interface LineProps {
  data: ChartData<'line', number[], string>
  options: ChartOptions<'line'>
  role?: string
  'aria-label'?: string
}

const chart = vi.hoisted(() => ({ props: null as LineProps | null }))

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Line: function Line(props: LineProps) {
    useEffect(() => {
      chart.props = props
    })
    return (
      <pre data-testid="line" role={props.role} aria-label={props['aria-label']}>
        {JSON.stringify(props.data)}
      </pre>
    )
  },
}))

const plotted = () => JSON.parse(screen.getByTestId('line').textContent ?? '{}')

const plain = (text: string) => text.replace(/\s/g, ' ')

function tooltipLabel(dataIndex: number): string {
  const label = chart.props?.options.plugins?.tooltip?.callbacks?.label
  if (!label) throw new Error('the line chart has no tooltip label callback')
  return plain(String(label.call({} as never, { dataIndex } as never)))
}

function axisLabel(value: number): string {
  const callback = chart.props?.options.scales?.y?.ticks?.callback
  if (!callback) throw new Error('the y axis has no tick callback')
  return plain(String(callback.call({} as never, value, 0, [])))
}

beforeEach(() => {
  vi.resetAllMocks()
  chart.props = null
  document.documentElement.style.removeProperty('--accent')
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
  act(() => useThemeStore.getState().setTheme('dark'))
})

describe('NetTrendChart', () => {
  it('plots the running balance in major units, including a negative balance', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 10000,
      items: [
        { month: '2026-08', balanceMinor: 306000 },
        { month: '2026-09', balanceMinor: -1250 },
      ],
    })

    renderWithProviders(<NetTrendChart months={6} />)
    await screen.findByTestId('line')

    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls[0]?.[0]).toBe(6)
    expect(plotted().labels).toEqual(['August 2026', 'September 2026'])
    expect(plotted().datasets[0].data).toEqual([3060, -12.5])
  })

  it('offers the table alternative with formatted balances', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 123456 }],
    })

    renderWithProviders(<NetTrendChart />)

    const table = await screen.findByRole('table', { name: /balance/i })
    expect(within(table).getByRole('cell', { name: '$1,234.56' })).toBeInTheDocument()
  })

  it('shows a negative balance as money in the table, tooltip and canvas summary', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 10000,
      items: [
        { month: '2026-08', balanceMinor: 306000 },
        { month: '2026-09', balanceMinor: -1250 },
      ],
    })

    renderWithProviders(<NetTrendChart />)

    const table = await screen.findByRole('table', { name: /balance/i })
    expect(
      within(table)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['MonthBalance', 'August 2026$3,060.00', 'September 2026-$12.50'])
    expect(tooltipLabel(1)).toBe('Balance: -$12.50')
    expect(screen.getByRole('img')).toHaveAccessibleName(
      /August 2026 to September 2026.*ending at -\$12\.50/,
    )
  })

  it.each([
    ['JPY', 123456, [123456], '¥123,456', 2000, '¥2,000'],
    ['BHD', -1234, [-1.234], '-BHD 1.234', -0.5, '-BHD 0.500'],
  ])(
    'shows %s with the right number of decimals in the plot, table, tooltip and axis',
    async (currency, balanceMinor, expectedPlot, text, axisValue, axisText) => {
      vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
        currency,
        openingMinor: 0,
        items: [{ month: '2026-09', balanceMinor }],
      })

      renderWithProviders(<NetTrendChart />)
      const table = await screen.findByRole('table', { name: /balance/i })

      expect(plotted().datasets[0].data).toEqual(expectedPlot)
      const cells = within(table)
        .getAllByRole('cell')
        .map((cell) => plain(cell.textContent ?? ''))
      expect(cells).toContain(text)
      expect(tooltipLabel(0)).toBe(`Balance: ${text}`)
      expect(axisLabel(axisValue)).toBe(axisText)
    },
  )

  it('takes the line colour from the theme and follows theme changes', async () => {
    document.documentElement.style.setProperty('--accent', '#3538cd')
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 100 }],
    })

    renderWithProviders(<NetTrendChart />)
    await screen.findByTestId('line')
    expect(plotted().datasets[0].borderColor).toBe('#3538cd')

    document.documentElement.style.setProperty('--accent', '#9fb0ff')
    act(() => useThemeStore.getState().setTheme('light'))

    expect(plotted().datasets[0].borderColor).toBe('#9fb0ff')
  })

  it('turns animation off when the user prefers reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 100 }],
    })

    renderWithProviders(<NetTrendChart />)
    await screen.findByTestId('line')

    expect(chart.props?.options.animation).toBe(false)
  })

  it('shows loading, empty and error states', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderWithProviders(<NetTrendChart />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()

    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 0 }],
    })
    const second = renderWithProviders(<NetTrendChart />)
    expect(await screen.findByText('No balance to show yet')).toBeInTheDocument()
    second.unmount()

    vi.mocked(financeApi.fetchBalanceTrend).mockRejectedValue(new Error('boom'))
    renderWithProviders(<NetTrendChart />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('retries after an error', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 100 }],
    })

    renderWithProviders(<NetTrendChart />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('line')).toBeInTheDocument()
  })

  it('shows an empty state rather than a chart when a balance is opening-only', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 5000,
      items: [],
    })

    renderWithProviders(<NetTrendChart />)

    expect(await screen.findByText('No balance to show yet')).toBeInTheDocument()
    expect(screen.queryByTestId('line')).not.toBeInTheDocument()
  })
})
