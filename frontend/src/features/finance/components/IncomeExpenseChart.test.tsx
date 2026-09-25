import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChartData, ChartOptions } from 'chart.js'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/shared/theme/themeStore'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { IncomeExpenseChart } from './IncomeExpenseChart'

interface BarProps {
  data: ChartData<'bar', number[], string>
  options: ChartOptions<'bar'>
  role?: string
  'aria-label'?: string
}

const chart = vi.hoisted(() => ({ props: null as BarProps | null }))

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Bar: function Bar(props: BarProps) {
    useEffect(() => {
      chart.props = props
    })
    return (
      <pre data-testid="bar" role={props.role} aria-label={props['aria-label']}>
        {JSON.stringify(props.data)}
      </pre>
    )
  },
}))

const plotted = () => JSON.parse(screen.getByTestId('bar').textContent ?? '{}')

const plain = (text: string) => text.replace(/\s/g, ' ')

function tooltipLabel(datasetIndex: number, dataIndex: number): string {
  const label = chart.props?.options.plugins?.tooltip?.callbacks?.label
  if (!label) throw new Error('the bar chart has no tooltip label callback')
  return plain(String(label.call({} as never, { datasetIndex, dataIndex } as never)))
}

function axisLabel(value: number): string {
  const callback = chart.props?.options.scales?.y?.ticks?.callback
  if (!callback) throw new Error('the y axis has no tick callback')
  return plain(String(callback.call({} as never, value, 0, [])))
}

beforeEach(() => {
  vi.resetAllMocks()
  chart.props = null
  document.documentElement.style.removeProperty('--positive')
  document.documentElement.style.removeProperty('--danger')
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
  act(() => useThemeStore.getState().setTheme('dark'))
})

describe('IncomeExpenseChart', () => {
  it('plots income and expenses per month, oldest first, and asks for the chosen range', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [
        { month: '2026-08', incomeMinor: 300000, expenseMinor: 4000, netMinor: 296000 },
        { month: '2026-09', incomeMinor: 0, expenseMinor: 1250, netMinor: -1250 },
      ],
    })

    renderWithProviders(<IncomeExpenseChart months={12} />)
    await screen.findByTestId('bar')

    expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls[0]?.[0]).toBe(12)
    expect(plotted().labels).toEqual(['August 2026', 'September 2026'])
    const [income, expenses] = plotted().datasets
    expect([income.label, income.data]).toEqual(['Income', [3000, 0]])
    expect([expenses.label, expenses.data]).toEqual(['Expenses', [40, 12.5]])
  })

  it('asks for the window that ends at the given month and says so in its caption', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-05', incomeMinor: 100, expenseMinor: 50, netMinor: 50 }],
    })

    renderWithProviders(<IncomeExpenseChart months={6} to="2026-05" />)

    expect(await screen.findByRole('table', { name: /6 months to May 2026/i })).toBeInTheDocument()
    expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls[0]).toEqual([6, '2026-05'])
  })

  it('offers the table alternative with formatted amounts', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 300000, expenseMinor: 1250, netMinor: 298750 }],
    })

    renderWithProviders(<IncomeExpenseChart />)

    const table = await screen.findByRole('table', { name: /income and expenses/i })
    expect(within(table).getByRole('cell', { name: '$3,000.00' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '$12.50' })).toBeInTheDocument()
  })

  it('lists exactly the plotted months in the table and labels the canvas', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [
        { month: '2026-08', incomeMinor: 300000, expenseMinor: 4000, netMinor: 296000 },
        { month: '2026-09', incomeMinor: 0, expenseMinor: 1250, netMinor: -1250 },
      ],
    })

    renderWithProviders(<IncomeExpenseChart />)

    const table = await screen.findByRole('table', { name: /income and expenses/i })
    const rows = within(table).getAllByRole('row')
    expect(rows.map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual([
      ['Month', 'Income', 'Expenses'],
      ['August 2026', '$3,000.00', '$40.00'],
      ['September 2026', '$0.00', '$12.50'],
    ])
    expect(screen.getByRole('img')).toHaveAccessibleName(/August 2026 to September 2026/)
  })

  it.each([
    ['JPY', 5000, 750, [5000, 750], '¥5,000', '¥750', '¥1,500'],
    ['BHD', 1234, 5, [1.234, 0.005], 'BHD 1.234', 'BHD 0.005', 'BHD 2.500'],
  ])(
    'shows %s with the right number of decimals in the plot, table, tooltip and axis',
    async (
      currency,
      incomeMinor,
      expenseMinor,
      plottedIncomeAndExpense,
      incomeText,
      expenseText,
      axisText,
    ) => {
      vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
        currency,
        items: [
          { month: '2026-09', incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor },
        ],
      })

      renderWithProviders(<IncomeExpenseChart />)
      const table = await screen.findByRole('table', { name: /income and expenses/i })

      expect([plotted().datasets[0].data[0], plotted().datasets[1].data[0]]).toEqual(
        plottedIncomeAndExpense,
      )
      const cells = within(table)
        .getAllByRole('cell')
        .map((cell) => plain(cell.textContent ?? ''))
      expect(cells).toContain(incomeText)
      expect(cells).toContain(expenseText)
      expect(tooltipLabel(0, 0)).toBe(`Income: ${incomeText}`)
      expect(tooltipLabel(1, 0)).toBe(`Expenses: ${expenseText}`)
      expect(axisLabel(currency === 'JPY' ? 1500 : 2.5)).toBe(axisText)
    },
  )

  it('takes the bar colours from the theme and follows theme changes', async () => {
    document.documentElement.style.setProperty('--positive', '#00aa00')
    document.documentElement.style.setProperty('--danger', '#aa0000')
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 100, expenseMinor: 50, netMinor: 50 }],
    })

    renderWithProviders(<IncomeExpenseChart />)
    await screen.findByTestId('bar')
    expect(
      plotted().datasets.map((dataset: { backgroundColor: string }) => dataset.backgroundColor),
    ).toEqual(['#00aa00', '#aa0000'])

    document.documentElement.style.setProperty('--positive', '#11cc11')
    document.documentElement.style.setProperty('--danger', '#cc1111')
    act(() => useThemeStore.getState().setTheme('light'))

    expect(
      plotted().datasets.map((dataset: { backgroundColor: string }) => dataset.backgroundColor),
    ).toEqual(['#11cc11', '#cc1111'])
  })

  it('turns animation off when the user prefers reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 100, expenseMinor: 50, netMinor: 50 }],
    })

    renderWithProviders(<IncomeExpenseChart />)
    await screen.findByTestId('bar')

    expect(chart.props?.options.animation).toBe(false)
  })

  it('shows an empty state when every month is zero', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 0, expenseMinor: 0, netMinor: 0 }],
    })

    renderWithProviders(<IncomeExpenseChart />)

    expect(await screen.findByText('No income or expenses yet')).toBeInTheDocument()
    expect(screen.queryByTestId('bar')).not.toBeInTheDocument()
  })

  it('shows a loading state', () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockReturnValue(new Promise(() => {}))

    renderWithProviders(<IncomeExpenseChart />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('shows an error state with a retry', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 100, expenseMinor: 50, netMinor: 50 }],
    })

    renderWithProviders(<IncomeExpenseChart />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('bar')).toBeInTheDocument()
  })
})
