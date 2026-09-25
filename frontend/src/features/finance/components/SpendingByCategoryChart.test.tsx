import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChartData, ChartOptions } from 'chart.js'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/shared/theme/themeStore'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { SpendingByCategoryChart } from './SpendingByCategoryChart'

interface DoughnutProps {
  data: ChartData<'doughnut', number[], string>
  options: ChartOptions<'doughnut'>
  role?: string
  'aria-label'?: string
}

const chart = vi.hoisted(() => ({ props: null as DoughnutProps | null }))

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Doughnut: function Doughnut(props: DoughnutProps) {
    useEffect(() => {
      chart.props = props
    })
    return (
      <pre data-testid="doughnut" role={props.role} aria-label={props['aria-label']}>
        {JSON.stringify(props.data)}
      </pre>
    )
  },
}))

const plain = (text: string | null) => (text ?? '').replace(/\s/g, ' ')

const cellTexts = (table: HTMLElement) =>
  within(table)
    .getAllByRole('cell')
    .map((cell) => plain(cell.textContent))

const plotted = () => JSON.parse(screen.getByTestId('doughnut').textContent ?? '{}')

function tooltipLabel(index: number): string {
  const label = chart.props?.options.plugins?.tooltip?.callbacks?.label
  if (!label) throw new Error('the doughnut has no tooltip label callback')
  // Only the fields the callback reads are needed.
  return plain(String(label.call({} as never, { dataIndex: index } as never)))
}

function report(
  currency: string,
  items: { name: string; totalMinor: number; categoryId?: string }[],
) {
  vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
    month: '2026-09',
    currency,
    items: items.map((item, index) => ({ categoryId: `id-${index}`, ...item })),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  chart.props = null
  document.documentElement.style.removeProperty('--chart-1')
})

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
  act(() => useThemeStore.getState().setTheme('dark'))
})

describe('SpendingByCategoryChart', () => {
  it('shows a loading state, then the chart', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 7500 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
  })

  it('plots categories in major units and asks for the chosen month', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [
        { categoryId: 'a', name: 'Groceries', totalMinor: 7500 },
        { categoryId: 'b', name: 'Transport', totalMinor: 1205 },
      ],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(vi.mocked(financeApi.fetchSpendingByCategory).mock.calls[0]?.[0]).toBe('2026-09')
    expect(plotted().labels).toEqual(['Groceries', 'Transport'])
    expect(plotted().datasets[0].data).toEqual([75, 12.05])
  })

  it.each([
    ['JPY', 500, 500],
    ['BHD', 1234, 1.234],
  ])(
    'plots %s amounts with the right number of decimals',
    async (currency, totalMinor, expected) => {
      report(currency, [{ name: 'Food', totalMinor }])

      renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
      await screen.findByTestId('doughnut')

      expect(plotted().datasets[0].data).toEqual([expected])
    },
  )

  it.each([
    ['USD', 7500, '$75.00'],
    ['JPY', 500, '¥500'],
    ['BHD', 1234, 'BHD 1.234'],
  ])('shows %s amounts in the table and tooltip as money', async (currency, totalMinor, shown) => {
    report(currency, [{ name: 'Food', totalMinor }])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const table = await screen.findByRole('table', { name: /spending by category/i })
    expect(cellTexts(table)).toContain(shown)
    expect(tooltipLabel(0)).toBe(`Food: ${shown}`)
  })

  it('gives screen readers the same numbers in a table, formatted as money', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 7500 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const table = await screen.findByRole('table', { name: /spending by category/i })
    expect(within(table).getByRole('cell', { name: 'Groceries' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '$75.00' })).toBeInTheDocument()
  })

  it('labels the canvas with a text summary that points to the table', async () => {
    report('USD', [
      { name: 'Groceries', totalMinor: 7500 },
      { name: 'Transport', totalMinor: 1205 },
    ])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const canvas = await screen.findByRole('img')
    expect(canvas).toHaveAccessibleName(/September 2026/)
    expect(canvas).toHaveAccessibleName(/2 categories/)
    expect(canvas).toHaveAccessibleName(/largest Groceries at \$75\.00/)
  })

  it('lists every category, including several deleted ones, in a distinguishable order', async () => {
    report('USD', [
      { name: 'Groceries', totalMinor: 5000 },
      { name: 'Deleted category', totalMinor: 3000, categoryId: '' },
      { name: 'Deleted category', totalMinor: 1000, categoryId: '' },
    ])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const table = await screen.findByRole('table', { name: /spending by category/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['1', 'Groceries', '$50.00'],
      ['2', 'Deleted category', '$30.00'],
      ['3', 'Deleted category', '$10.00'],
    ])
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(plotted().labels).toEqual(['Groceries', 'Deleted category', 'Deleted category'])
  })

  it('keeps all of 30 long-named categories in the table and the plot', async () => {
    const longName = 'A very long category name that keeps going and going and going'
    report(
      'USD',
      Array.from({ length: 30 }, (_, index) => ({
        name: `${longName} ${index + 1}`,
        totalMinor: 3000 - index,
      })),
    )

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const table = await screen.findByRole('table', { name: /spending by category/i })
    expect(within(table).getAllByRole('row')).toHaveLength(31)
    expect(plotted().labels).toHaveLength(30)
    expect(plotted().datasets[0].backgroundColor).toHaveLength(30)
  })

  it('takes segment colours from the current theme', async () => {
    document.documentElement.style.setProperty('--chart-1', '#123456')
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 100 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(plotted().datasets[0].backgroundColor[0]).toBe('#123456')
  })

  it('recolours the segments when the theme changes', async () => {
    document.documentElement.style.setProperty('--chart-1', '#123456')
    report('USD', [{ name: 'Groceries', totalMinor: 100 }])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    document.documentElement.style.setProperty('--chart-1', '#abcdef')
    act(() => useThemeStore.getState().setTheme('light'))

    expect(plotted().datasets[0].backgroundColor[0]).toBe('#abcdef')
  })

  it('turns animation off when the user prefers reduced motion', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    report('USD', [{ name: 'Groceries', totalMinor: 100 }])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(chart.props?.options.animation).toBe(false)
  })

  it('keeps the default animation otherwise', async () => {
    report('USD', [{ name: 'Groceries', totalMinor: 100 }])

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(chart.props?.options.animation).toBeUndefined()
  })

  it('invites the user to add an expense when there is no spending', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    expect(await screen.findByText('No spending this month')).toBeInTheDocument()
    expect(screen.queryByTestId('doughnut')).not.toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 100 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
  })
})
