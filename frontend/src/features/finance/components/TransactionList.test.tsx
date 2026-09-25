import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category, Transaction, TransactionPage } from '../types'
import { TransactionList } from './TransactionList'

vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e1', name: 'Groceries', kind: 'expense' },
  { id: 'i1', name: 'Salary', kind: 'income' },
]

function tx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    categoryId: 'e1',
    date: '2026-09-15',
    note: `note ${id}`,
    ...overrides,
  }
}

const page = (items: Transaction[], total = items.length, current = 1): TransactionPage => ({
  items,
  page: current,
  limit: 20,
  total,
})

function lastParams() {
  return vi.mocked(financeApi.listTransactions).mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

describe('TransactionList', () => {
  it('lists transactions with date, category, note and signed, formatted amounts', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([
        tx('1'),
        tx('2', { kind: 'income', categoryId: 'i1', amountMinor: 300000, note: 'pay' }),
      ]),
    )

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    const rows = await screen.findAllByRole('row')
    expect(await within(rows[1] as HTMLElement).findByText('Groceries')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('-$12.50')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('Sep 15, 2026')).toBeInTheDocument()
    expect(await within(rows[2] as HTMLElement).findByText('Salary')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('+$3,000.00')).toBeInTheDocument()
  })

  it('labels income and expense in words as well as by sign', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([tx('1'), tx('2', { kind: 'income', categoryId: 'i1' })]),
    )

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    const rows = await screen.findAllByRole('row')
    expect(within(rows[1] as HTMLElement).getByText('Expense')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('Income')).toBeInTheDocument()
  })

  it('formats every row in the currency it was recorded in', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([
        tx('1', { currency: 'JPY', amountMinor: 500 }),
        tx('2', { currency: 'BHD', amountMinor: 1234 }),
        tx('3', { currency: 'USD', amountMinor: 1250 }),
      ]),
    )

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('-¥500')).toBeInTheDocument()
    expect(screen.getByText(/^-.*1\.234$/)).toBeInTheDocument()
    expect(screen.getByText('-$12.50')).toBeInTheDocument()
  })

  it('shows "Deleted category" for an unknown category, and while categories load a placeholder', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([tx('1', { categoryId: 'gone' })]),
    )

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('Deleted category')).toBeInTheDocument()
  })

  it('does not call a category deleted when the categories could not be loaded', async () => {
    vi.mocked(financeApi.listCategories).mockRejectedValue(new Error('boom'))
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('Category unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Deleted category')).not.toBeInTheDocument()
  })

  it('shows loading first', () => {
    vi.mocked(financeApi.listTransactions).mockReturnValue(new Promise(() => {}))

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading transactions')
  })

  it('says so when there are no transactions', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([]))

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument()
  })

  it('says so when filters match nothing', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('No transactions yet')

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')

    expect(await screen.findByText('No transactions match these filters')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(financeApi.listTransactions).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))

    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('note 1')).toBeInTheDocument()
  })

  it('filters by type, category and dates, always starting from page 1', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')], 60))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'expense')
    await screen.findByRole('option', { name: 'Groceries' })
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await vi.waitFor(() => {
      expect(lastParams()).toMatchObject({ kind: 'expense', categoryId: 'e1', page: 1 })
    })
  })

  it('never sends a blank filter', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), '')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })

    await vi.waitFor(() => expect(lastParams()).toEqual({ page: 1, limit: 20 }))
    const calls = vi.mocked(financeApi.listTransactions).mock.calls
    expect(calls.some(([params]) => params.kind === 'income')).toBe(true)
    expect(calls.some(([params]) => params.from === '2026-09-01')).toBe(true)
    for (const [params] of calls) {
      expect(Object.values(params)).not.toContain('')
    }
  })

  it('offers only categories of the chosen type and drops a category that no longer fits', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByRole('option', { name: 'Groceries (expense)' })
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries (expense)')

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')

    expect(screen.queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
    await vi.waitFor(() => expect(lastParams()).toEqual({ kind: 'income', page: 1, limit: 20 }))
  })

  it('does not send a date range that ends before it starts, and says why', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } })
    await vi.waitFor(() => expect(lastParams()).toMatchObject({ from: '2026-09-01' }))
    const calls = vi.mocked(financeApi.listTransactions).mock.calls.length

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date must not be after the end date',
    )
    expect(screen.getByLabelText('To')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('To')).toHaveAccessibleDescription(
      'The start date must not be after the end date',
    )
    expect(vi.mocked(financeApi.listTransactions).mock.calls.length).toBe(calls)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } })

    await vi.waitFor(() =>
      expect(lastParams()).toMatchObject({ from: '2026-09-01', to: '2026-09-30', page: 1 }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['a five-digit year', '20000-01-01'],
    ['a day that does not exist', '2026-02-30'],
    ['a year before 2000', '1999-12-31'],
    ['a year after 2100', '2101-01-01'],
  ])('does not send %s, and says why instead of failing to load', async (_name, typed) => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')
    const calls = vi.mocked(financeApi.listTransactions).mock.calls.length

    // Chrome can produce values a date input would normally refuse; jsdom sanitises them away.
    const from = screen.getByLabelText('From') as HTMLInputElement
    from.type = 'text'
    fireEvent.change(from, { target: { value: typed } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Use dates from 2000 to 2100')
    expect(from).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Could not load transactions')).not.toBeInTheDocument()
    expect(vi.mocked(financeApi.listTransactions).mock.calls.length).toBe(calls)
    for (const [params] of vi.mocked(financeApi.listTransactions).mock.calls) {
      expect(params.from).toBeUndefined()
    }
  })

  it('applies a valid range from the first to the last reportable date', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2000-01-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2100-12-31' } })

    await vi.waitFor(() =>
      expect(lastParams()).toMatchObject({ from: '2000-01-01', to: '2100-12-31', page: 1 }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pages forwards and back and shows where you are', async () => {
    vi.mocked(financeApi.listTransactions).mockImplementation(async (params) =>
      page([tx(`p${params.page}`)], 45, params.page ?? 1),
    )
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('note p2')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('note p2')).toBeInTheDocument()
  })

  it('steps back to the last page that still exists when the current one empties', async () => {
    let total = 41
    vi.mocked(financeApi.listTransactions).mockImplementation(async (params) => {
      const current = params.page ?? 1
      const last = Math.ceil(total / 20)
      return current > last ? page([], total, current) : page([tx(`p${current}`)], total, current)
    })
    const { queryClient } = renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note p1')
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()

    total = 40
    await queryClient.invalidateQueries({ queryKey: ['finance'] })

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument()
    expect(await screen.findByText('note p2')).toBeInTheDocument()
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument()
  })

  it('opens a transaction for editing', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    const onEdit = vi.fn()
    renderWithProviders(<TransactionList onEdit={onEdit} />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Edit note 1, 2026-09-15, -$12.50' }),
    )

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })

  it('gives an edit button a distinct name even when the note is empty', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1', { note: '' })]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(
      await screen.findByRole('button', { name: 'Edit Groceries, 2026-09-15, -$12.50' }),
    ).toBeInTheDocument()
  })

  it('names two rows with the same note apart by date and amount', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([
        tx('1', { note: 'Lunch', date: '2026-09-01', amountMinor: 1250 }),
        tx('2', { note: 'Lunch', date: '2026-09-02', amountMinor: 1250 }),
        tx('3', { note: 'Lunch', date: '2026-09-02', kind: 'income', categoryId: 'i1' }),
      ]),
    )
    const onEdit = vi.fn()
    renderWithProviders(<TransactionList onEdit={onEdit} />)

    const buttons = await screen.findAllByRole('button', { name: /^Edit Lunch/ })

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Edit Lunch, 2026-09-01, -$12.50',
      'Edit Lunch, 2026-09-02, -$12.50',
      'Edit Lunch, 2026-09-02, +$12.50',
    ])
    await userEvent.click(buttons[1] as HTMLElement)
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }))
  })

  it('formats the amount in the row currency in the button name', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([tx('1', { currency: 'JPY', amountMinor: 500, note: 'Bus' })]),
    )
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(
      await screen.findByRole('button', { name: 'Edit Bus, 2026-09-15, -¥500' }),
    ).toBeInTheDocument()
  })

  it('tells same-named categories of different types apart while the type filter is All', async () => {
    vi.mocked(financeApi.listCategories).mockResolvedValue([
      { id: 'e1', name: 'Other', kind: 'expense' },
      { id: 'i1', name: 'Other', kind: 'income' },
      { id: 'i2', name: 'Salary', kind: 'income' },
    ])
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByRole('option', { name: 'Other (expense)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Other (income)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Salary (income)' })).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')

    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\(income\)/ })).not.toBeInTheDocument()
  })

  it('has one interactive control per row, so none is nested inside another', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1'), tx('2')]))
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    const rows = await screen.findAllByRole('row')

    for (const row of rows.slice(1)) {
      expect(within(row).getAllByRole('button')).toHaveLength(1)
    }
  })
})
