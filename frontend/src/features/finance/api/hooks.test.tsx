import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/shared/ui/toast'
import type { MonthSummary, Transaction, TransactionInput, TransactionPage } from '../types'
import * as financeApi from './financeApi'
import {
  useBalanceTrend,
  useBulkCreateTransactions,
  useCategories,
  useCreateCategory,
  useCreateTransaction,
  useDeleteCategory,
  useDeleteTransaction,
  useMonthlyTotals,
  useMonthSummary,
  useRenameCategory,
  useSpendingByCategory,
  useTransactions,
  useUpdateTransaction,
} from './hooks'
import { financeKeys } from './financeKeys'

vi.mock('./financeApi')

const input: TransactionInput = {
  kind: 'expense',
  amountMinor: 1234,
  categoryId: 'c1',
  date: '2026-09-01',
  note: '',
}

const transaction: Transaction = { ...input, id: 't1', currency: 'USD' }

const summary = (month: string): MonthSummary => ({
  month,
  currency: 'USD',
  incomeMinor: 0,
  expenseMinor: 0,
  netMinor: 0,
})

const txPage: TransactionPage = { items: [], page: 1, limit: 50, total: 0 }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, invalidate, wrapper }
}

beforeEach(() => {
  vi.resetAllMocks()
  useToastStore.setState({ toasts: [] })
})

describe('read hooks', () => {
  it('loads all categories', async () => {
    vi.mocked(financeApi.listCategories).mockResolvedValue([
      { id: 'c1', name: 'Food', kind: 'expense' },
    ])
    const { wrapper } = setup()

    const { result } = renderHook(() => useCategories(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(financeApi.listCategories).toHaveBeenCalledWith()
    expect(result.current.data).toHaveLength(1)
  })

  it('loads transactions with the given filters and page', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(txPage)
    const { wrapper } = setup()
    const params = { kind: 'income', page: 2, limit: 50 } as const

    const { result } = renderHook(() => useTransactions(params), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(financeApi.listTransactions).toHaveBeenCalledWith(params)
  })

  it('keys a month report by its month, so switching month never shows the old month as current', async () => {
    vi.mocked(financeApi.fetchSummary).mockImplementation(async (month) => summary(month))
    const { wrapper } = setup()

    const { result, rerender } = renderHook(({ month }) => useMonthSummary(month), {
      wrapper,
      initialProps: { month: '2026-08' },
    })
    await waitFor(() => expect(result.current.data?.month).toBe('2026-08'))

    rerender({ month: '2026-09' })

    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.data?.month).toBe('2026-09'))
    expect(financeApi.fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('asks for each report with its own month or range', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [],
    })
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({ currency: 'USD', items: [] })
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [],
    })
    const { wrapper } = setup()

    const byCategory = renderHook(() => useSpendingByCategory('2026-09'), { wrapper })
    const monthly = renderHook(() => useMonthlyTotals(12), { wrapper })
    const trend = renderHook(() => useBalanceTrend(6), { wrapper })
    await waitFor(() => expect(byCategory.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(monthly.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(trend.result.current.isSuccess).toBe(true))

    expect(financeApi.fetchSpendingByCategory).toHaveBeenCalledWith('2026-09')
    expect(financeApi.fetchMonthlyTotals).toHaveBeenCalledWith(12, undefined)
    expect(financeApi.fetchBalanceTrend).toHaveBeenCalledWith(6, undefined)
  })

  it('asks for a range that ends at the chosen month, and keeps each ending apart', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({ currency: 'USD', items: [] })
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [],
    })
    const { wrapper } = setup()

    const monthly = renderHook(() => useMonthlyTotals(6, '2026-05'), { wrapper })
    const trend = renderHook(() => useBalanceTrend(12, '2026-05'), { wrapper })
    await waitFor(() => expect(monthly.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(trend.result.current.isSuccess).toBe(true))

    expect(financeApi.fetchMonthlyTotals).toHaveBeenCalledWith(6, '2026-05')
    expect(financeApi.fetchBalanceTrend).toHaveBeenCalledWith(12, '2026-05')
    expect(financeKeys.monthly(6, '2026-05')).not.toEqual(financeKeys.monthly(6, '2026-06'))
    expect(financeKeys.trend(6, '2026-05')).not.toEqual(financeKeys.trend(6))
  })

  it('keys a range by its length', () => {
    expect(financeKeys.monthly(6)).not.toEqual(financeKeys.monthly(12))
    expect(financeKeys.trend(6)).not.toEqual(financeKeys.trend(12))
  })
})

describe('write hooks', () => {
  it('create transaction sends the input and invalidates every finance query', async () => {
    vi.mocked(financeApi.createTransaction).mockResolvedValue(transaction)
    const { invalidate, wrapper } = setup()

    const { result } = renderHook(() => useCreateTransaction(), { wrapper })
    result.current.mutate(input)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(financeApi.createTransaction).mock.calls[0]?.[0]).toEqual(input)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('update transaction sends the id and the changed fields, then invalidates', async () => {
    vi.mocked(financeApi.updateTransaction).mockResolvedValue(transaction)
    const { invalidate, wrapper } = setup()

    const { result } = renderHook(() => useUpdateTransaction(), { wrapper })
    result.current.mutate({ id: 't1', input: { amountMinor: 500 } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(financeApi.updateTransaction).toHaveBeenCalledWith('t1', { amountMinor: 500 })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('bulk create sends the rows and invalidates', async () => {
    vi.mocked(financeApi.bulkCreateTransactions).mockResolvedValue({ created: 1 })
    const { invalidate, wrapper } = setup()

    const { result } = renderHook(() => useBulkCreateTransactions(), { wrapper })
    result.current.mutate([input])
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(financeApi.bulkCreateTransactions).mock.calls[0]?.[0]).toEqual([input])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('category create and rename invalidate, because reports show category names', async () => {
    vi.mocked(financeApi.createCategory).mockResolvedValue({
      id: 'c2',
      name: 'Pets',
      kind: 'expense',
    })
    vi.mocked(financeApi.renameCategory).mockResolvedValue({
      id: 'c2',
      name: 'Cats',
      kind: 'expense',
    })
    const { invalidate, wrapper } = setup()

    const create = renderHook(() => useCreateCategory(), { wrapper })
    create.result.current.mutate({ name: 'Pets', kind: 'expense' })
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true))
    const rename = renderHook(() => useRenameCategory(), { wrapper })
    rename.result.current.mutate({ id: 'c2', name: 'Cats' })
    await waitFor(() => expect(rename.result.current.isSuccess).toBe(true))

    expect(financeApi.renameCategory).toHaveBeenCalledWith('c2', 'Cats')
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('refetches a mounted report after a transaction is created', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue(summary('2026-09'))
    vi.mocked(financeApi.createTransaction).mockResolvedValue(transaction)
    const { wrapper } = setup()

    const report = renderHook(() => useMonthSummary('2026-09'), { wrapper })
    await waitFor(() => expect(report.result.current.isSuccess).toBe(true))
    const create = renderHook(() => useCreateTransaction(), { wrapper })
    create.result.current.mutate(input)

    await waitFor(() => expect(financeApi.fetchSummary).toHaveBeenCalledTimes(2))
  })

  it('does not toast when a create or update fails: the form shows the error inline', async () => {
    vi.mocked(financeApi.createTransaction).mockRejectedValue(new Error('nope'))
    vi.mocked(financeApi.updateTransaction).mockRejectedValue(new Error('nope'))
    vi.mocked(financeApi.createCategory).mockRejectedValue(new Error('nope'))
    vi.mocked(financeApi.renameCategory).mockRejectedValue(new Error('nope'))
    vi.mocked(financeApi.bulkCreateTransactions).mockRejectedValue(new Error('nope'))
    const { invalidate, wrapper } = setup()

    const create = renderHook(() => useCreateTransaction(), { wrapper })
    const update = renderHook(() => useUpdateTransaction(), { wrapper })
    const newCategory = renderHook(() => useCreateCategory(), { wrapper })
    const rename = renderHook(() => useRenameCategory(), { wrapper })
    const bulk = renderHook(() => useBulkCreateTransactions(), { wrapper })
    create.result.current.mutate(input)
    update.result.current.mutate({ id: 't1', input: {} })
    newCategory.result.current.mutate({ name: 'x', kind: 'income' })
    rename.result.current.mutate({ id: 'c1', name: 'x' })
    bulk.result.current.mutate([input])

    for (const hook of [create, update, newCategory, rename, bulk]) {
      await waitFor(() => expect(hook.result.current.isError).toBe(true))
    }
    expect(useToastStore.getState().toasts).toEqual([])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('delete transaction invalidates on success', async () => {
    vi.mocked(financeApi.deleteTransaction).mockResolvedValue()
    const { invalidate, wrapper } = setup()

    const { result } = renderHook(() => useDeleteTransaction(), { wrapper })
    result.current.mutate('t1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(financeApi.deleteTransaction).mock.calls[0]?.[0]).toBe('t1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('delete category invalidates on success', async () => {
    vi.mocked(financeApi.deleteCategory).mockResolvedValue()
    const { invalidate, wrapper } = setup()

    const { result } = renderHook(() => useDeleteCategory(), { wrapper })
    result.current.mutate('c1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(financeApi.deleteCategory).mock.calls[0]?.[0]).toBe('c1')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: financeKeys.all })
  })

  it('toasts when a delete fails, and does not invalidate', async () => {
    vi.mocked(financeApi.deleteTransaction).mockRejectedValue(new Error('gone wrong'))
    vi.mocked(financeApi.deleteCategory).mockRejectedValue(new Error('gone wrong'))
    const { invalidate, wrapper } = setup()

    const tx = renderHook(() => useDeleteTransaction(), { wrapper })
    const category = renderHook(() => useDeleteCategory(), { wrapper })
    tx.result.current.mutate('t1')
    category.result.current.mutate('c1')
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(2))

    const messages = useToastStore.getState().toasts.map((toast) => toast.message)
    expect(messages[0]).toContain('transaction')
    expect(messages[1]).toContain('category')
    expect(messages.every((message) => message.includes('gone wrong'))).toBe(true)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
