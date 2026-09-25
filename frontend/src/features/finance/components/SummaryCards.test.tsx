import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { MonthSummary } from '../types'
import { SummaryCards } from './SummaryCards'

vi.mock('../api/financeApi')

beforeEach(() => {
  vi.resetAllMocks()
})

function summary(overrides: Partial<MonthSummary> = {}): MonthSummary {
  return {
    month: '2026-09',
    currency: 'USD',
    incomeMinor: 300000,
    expenseMinor: 8700,
    netMinor: 291300,
    ...overrides,
  }
}

describe('SummaryCards', () => {
  it('shows income, expenses and net for the month, formatted as money', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(summary())

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect(await screen.findByText('$3,000.00')).toBeInTheDocument()
    expect(screen.getByText('$87.00')).toBeInTheDocument()
    expect(screen.getByText('$2,913.00')).toBeInTheDocument()
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe('2026-09')
  })

  it('marks a negative net with a minus sign and a word, so it is not only a colour', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(
      summary({ incomeMinor: 0, expenseMinor: 999, netMinor: -999 }),
    )

    renderWithProviders(<SummaryCards month="2026-09" />)

    const net = await screen.findByText('-$9.99')
    expect(net).toHaveClass('is-negative')
    expect(screen.getByText('Spent more than earned')).toBeInTheDocument()
  })

  it('does not call a positive or zero net an overspend', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(summary())

    renderWithProviders(<SummaryCards month="2026-09" />)

    await screen.findByText('$2,913.00')
    expect(screen.queryByText('Spent more than earned')).not.toBeInTheDocument()
  })

  it('formats currencies without decimals correctly', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(
      summary({ currency: 'JPY', incomeMinor: 500, expenseMinor: 0, netMinor: 500 }),
    )

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect((await screen.findAllByText('¥500')).length).toBeGreaterThan(0)
  })

  it('formats three-decimal currencies from the response currency', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(
      summary({ currency: 'BHD', incomeMinor: 1234, expenseMinor: 0, netMinor: 1234 }),
    )

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect((await screen.findAllByText(/1\.234/)).length).toBeGreaterThan(0)
  })

  it('says so when the month has no transactions, while still showing zeros', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(
      summary({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 }),
    )

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect(await screen.findByText('No transactions in September 2026')).toBeInTheDocument()
    expect(screen.getAllByText('$0.00')).toHaveLength(3)
  })

  it('shows loading, then an error with a retry', async () => {
    vi.mocked(financeApi.fetchSummary).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(
      summary({ incomeMinor: 100, expenseMinor: 0, netMinor: 100 }),
    )

    renderWithProviders(<SummaryCards month="2026-09" />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect((await screen.findAllByText('$1.00')).length).toBeGreaterThan(0)
  })

  it('announces the totals once in one polite live region rather than per card', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(summary())

    const { container } = renderWithProviders(<SummaryCards month="2026-09" />)
    await screen.findByText('$87.00')

    const regions = container.querySelectorAll('[aria-live]')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toHaveAttribute('aria-live', 'polite')
    expect(regions[0]).toHaveTextContent(
      'September 2026: income $3,000.00, expenses $87.00, net $2,913.00',
    )
  })

  it('keeps the live region mounted while the next month loads, empty so nothing is announced twice', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(summary())
    function Harness() {
      const [month, setMonth] = useState('2026-09')
      return (
        <>
          <button type="button" onClick={() => setMonth('2026-10')}>
            Next
          </button>
          <SummaryCards month={month} />
        </>
      )
    }
    const { container } = renderWithProviders(<Harness />)
    await screen.findByText('$87.00')
    const region = container.querySelector('[aria-live]')

    vi.mocked(financeApi.fetchSummary).mockReturnValue(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(container.querySelector('[aria-live]')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })
})
