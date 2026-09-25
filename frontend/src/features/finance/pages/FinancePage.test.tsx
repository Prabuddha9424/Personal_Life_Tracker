import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentMonthIso, shiftMonthIso } from '@/shared/lib/dates'
import { useToastStore } from '@/shared/ui/toast'
import * as financeApi from '../api/financeApi'
import type { Transaction, TransactionPage } from '../types'
import FinancePage from './FinancePage'

vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: 'USD' }),
}))
vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Doughnut: () => <div data-testid="doughnut" />,
  Bar: () => <div data-testid="bar" />,
  Line: () => <div data-testid="line" />,
}))

const categories = [
  { id: 'e1', name: 'Groceries', kind: 'expense' as const },
  { id: 'e2', name: 'Other', kind: 'expense' as const },
  { id: 'i1', name: 'Other', kind: 'income' as const },
]

const emptyPage: TransactionPage = { items: [], page: 1, limit: 20, total: 0 }

function tx(id: string, note: string): Transaction {
  return {
    id,
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    categoryId: 'e1',
    date: '2026-09-15',
    note,
  }
}

/** The page uses a route blocker, which needs a data router. */
function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/finance', element: <FinancePage /> },
      { path: '/other', element: <p>Other page</p> },
    ],
    { initialEntries: ['/finance'] },
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient, ...view }
}

beforeEach(() => {
  vi.resetAllMocks()
  useToastStore.setState({ toasts: [] })
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
  vi.mocked(financeApi.fetchSummary).mockImplementation(async (month) => ({
    month,
    currency: 'USD',
    incomeMinor: 300000,
    expenseMinor: 8700,
    netMinor: 291300,
  }))
  vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
    month: '',
    currency: 'USD',
    items: [{ categoryId: 'e1', name: 'Groceries', totalMinor: 8700 }],
  })
  vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
    currency: 'USD',
    items: [{ month: '2026-09', incomeMinor: 300000, expenseMinor: 8700, netMinor: 291300 }],
  })
  vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
    currency: 'USD',
    openingMinor: 0,
    items: [{ month: '2026-09', balanceMinor: 291300 }],
  })
  vi.mocked(financeApi.listTransactions).mockResolvedValue(emptyPage)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FinancePage', () => {
  it('shows the summary cards, all three charts and the transaction list', async () => {
    renderPage()

    expect((await screen.findAllByText('$3,000.00')).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
    expect(await screen.findByTestId('bar')).toBeInTheDocument()
    expect(await screen.findByTestId('line')).toBeInTheDocument()
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument()
  })

  it('has one h1, h2 headings for its sections and labelled regions', async () => {
    renderPage()
    await screen.findByTestId('doughnut')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Finance')
    for (const name of ['Where the money went', 'Income vs expenses', 'Balance', 'Transactions']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Charts' })).toBeInTheDocument()
    const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('starts on the local current month, even when that differs from the UTC month', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 0, 31, 23, 30) })

    renderPage()

    await screen.findByTestId('doughnut')
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe('2026-01')
    expect(vi.mocked(financeApi.fetchSpendingByCategory).mock.calls[0]?.[0]).toBe('2026-01')
    expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls[0]).toEqual([6, '2026-01'])
    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls[0]).toEqual([6, '2026-01'])
  })

  it('reloads the month-based views, the charts window and the list range when the month changes', async () => {
    renderPage()
    await screen.findAllByText('$3,000.00')
    const current = currentMonthIso()
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe(current)

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    const previous = shiftMonthIso(current, -1)
    await waitFor(() =>
      expect(vi.mocked(financeApi.fetchSummary).mock.calls.at(-1)?.[0]).toBe(previous),
    )
    expect(vi.mocked(financeApi.fetchSpendingByCategory).mock.calls.at(-1)?.[0]).toBe(previous)
    await waitFor(() =>
      expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls.at(-1)).toEqual([6, previous]),
    )
    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls.at(-1)).toEqual([6, previous])
    await waitFor(() =>
      expect(vi.mocked(financeApi.listTransactions).mock.calls.at(-1)?.[0]).toMatchObject({
        from: `${previous}-01`,
      }),
    )
  })

  it('never shows the previous month as the current one while the new month loads', async () => {
    vi.mocked(financeApi.fetchSummary).mockImplementation(async (month) =>
      month === currentMonthIso()
        ? { month, currency: 'USD', incomeMinor: 123456, expenseMinor: 1000, netMinor: 122456 }
        : new Promise(() => {}),
    )
    vi.mocked(financeApi.fetchSpendingByCategory).mockImplementation(async (month) =>
      month === currentMonthIso()
        ? {
            month,
            currency: 'USD',
            items: [{ categoryId: 'e1', name: 'Groceries', totalMinor: 8700 }],
          }
        : new Promise(() => {}),
    )
    vi.mocked(financeApi.listTransactions).mockImplementation(async (params) =>
      params.from === `${currentMonthIso()}-01`
        ? { items: [tx('t1', 'current month coffee')], page: 1, limit: 20, total: 1 }
        : new Promise(() => {}),
    )
    renderPage()
    const summary = screen.getByRole('region', { name: 'Summary' })
    expect(await within(summary).findByText('$1,234.56')).toBeInTheDocument()
    expect(await screen.findByText('current month coffee')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    expect(within(summary).queryByText('$1,234.56')).not.toBeInTheDocument()
    expect(within(summary).getByText('Loading totals…')).toBeInTheDocument()
    expect(screen.queryByTestId('doughnut')).not.toBeInTheDocument()
    expect(screen.queryByText('current month coffee')).not.toBeInTheDocument()
    expect(screen.getByText('Loading transactions…')).toBeInTheDocument()
  })

  it('switches the bar and line charts between six and twelve months', async () => {
    renderPage()
    await screen.findByTestId('bar')

    await userEvent.selectOptions(screen.getByLabelText(/^chart range/i), '12')

    await waitFor(() =>
      expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls.at(-1)?.[0]).toBe(12),
    )
    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls.at(-1)?.[0]).toBe(12)
  })

  it('opens the add-transaction, import and category dialogs', async () => {
    renderPage()
    await screen.findAllByText('$3,000.00')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(screen.getByRole('dialog', { name: 'Import transactions from CSV' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    await userEvent.click(screen.getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('dialog', { name: 'Categories' })).toBeInTheDocument()
  })

  it.each(['Add transaction', 'Import CSV', 'Categories'])(
    'returns focus to the %s button when its dialog closes',
    async (name) => {
      renderPage()
      await screen.findAllByText('$3,000.00')
      const opener = screen.getByRole('button', { name })

      await userEvent.click(opener)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(opener).toHaveFocus()
    },
  )

  it('shows fresh data after a transaction is added', async () => {
    let created = false
    vi.mocked(financeApi.createTransaction).mockImplementation(async () => {
      created = true
      return tx('t9', 'Lunch')
    })
    vi.mocked(financeApi.listTransactions).mockImplementation(async () =>
      created ? { items: [tx('t9', 'Lunch')], page: 1, limit: 20, total: 1 } : emptyPage,
    )
    renderPage()
    await screen.findByText('No transactions yet')
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add transaction' })
    await userEvent.type(await within(dialog).findByLabelText(/^amount/i), '12.50')
    await userEvent.selectOptions(within(dialog).getByLabelText(/^category/i), 'Groceries')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Lunch')).toBeInTheDocument()
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument()
  })

  describe('a user with no transactions yet', () => {
    it('is told what to do next, and the charts explain themselves instead of being blank', async () => {
      vi.mocked(financeApi.fetchSummary).mockImplementation(async (month) => ({
        month,
        currency: 'USD',
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
      }))
      vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
        month: '',
        currency: 'USD',
        items: [],
      })
      vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({ currency: 'USD', items: [] })
      vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
        currency: 'USD',
        openingMinor: 0,
        items: [],
      })
      renderPage()

      const welcome = await screen.findByRole('region', { name: 'Getting started' })
      expect(within(welcome).getByText('No transactions yet')).toBeInTheDocument()
      expect(within(welcome).getByText(/add a transaction or import a csv/i)).toBeInTheDocument()
      expect(await screen.findByText('No spending this month')).toBeInTheDocument()
      expect(await screen.findByText('No income or expenses yet')).toBeInTheDocument()
      expect(await screen.findByText('No balance to show yet')).toBeInTheDocument()
      expect(screen.queryByTestId('doughnut')).not.toBeInTheDocument()
    })

    it('is not shown the getting-started prompt once the account has transactions', async () => {
      vi.mocked(financeApi.listTransactions).mockResolvedValue({
        items: [tx('t1', 'Coffee')],
        page: 1,
        limit: 20,
        total: 1,
      })
      renderPage()

      expect(await screen.findByText('Coffee')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()
    })

    it('still renders while the first categories request is slow, and the dialogs wait for it', async () => {
      vi.mocked(financeApi.listCategories).mockReturnValue(new Promise(() => {}))
      renderPage()

      expect(await screen.findAllByText('$3,000.00')).not.toHaveLength(0)
      expect(screen.getByRole('heading', { level: 1, name: 'Finance' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
      const dialog = screen.getByRole('dialog', { name: 'Add transaction' })
      expect(within(dialog).getByRole('status')).toHaveTextContent(/loading/i)
      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('button', { name: 'Categories' }))
      expect(
        within(screen.getByRole('dialog', { name: 'Categories' })).getByText('Loading categories…'),
      ).toBeInTheDocument()
    })
  })

  it('keeps no state of its own between visits', async () => {
    const first = renderPage()
    await screen.findAllByText('$3,000.00')
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    first.unmount()
    vi.mocked(financeApi.fetchSummary).mockClear()

    renderPage()

    await screen.findAllByText('$3,000.00')
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe(currentMonthIso())
  })

  describe('while a CSV import is running', () => {
    let release: () => void = () => {}

    async function startImport() {
      vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue({
        items: [],
        truncated: false,
      })
      vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(
        (rows) => new Promise((resolve) => (release = () => resolve({ created: rows.length }))),
      )
      const view = renderPage()
      await screen.findAllByText('$3,000.00')
      await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
      const csv = 'Date,Description,Amount\n2026-09-01,Coffee,-4.50\n2026-09-02,Pay,3000.00'
      await userEvent.upload(
        await screen.findByLabelText('CSV file'),
        new File([csv], 'bank.csv', { type: 'text/csv' }),
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Import 2 transactions' }))
      await screen.findByText(/Importing batch 1 of 1/)
      return view
    }

    function beforeUnload() {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event
    }

    it('blocks in-app navigation and warns before the tab is closed, then lets go when it ends', async () => {
      const { router } = await startImport()

      await act(() => router.navigate('/other'))
      expect(router.state.location.pathname).toBe('/finance')
      expect(useToastStore.getState().toasts).toHaveLength(1)
      expect(beforeUnload().defaultPrevented).toBe(true)

      release()
      await screen.findByText('Imported 2 transactions')
      // The dialog reports the end of the import from an effect, which can land just after the text.
      await waitFor(() => expect(beforeUnload().defaultPrevented).toBe(false))
      await act(() => router.navigate('/other'))
      expect(router.state.location.pathname).toBe('/other')
    })

    it('does not register the tab warning before an import starts', async () => {
      const { router } = renderPage()
      await screen.findAllByText('$3,000.00')

      expect(beforeUnload().defaultPrevented).toBe(false)
      await act(() => router.navigate('/other'))
      expect(router.state.location.pathname).toBe('/other')
    })
  })
})
