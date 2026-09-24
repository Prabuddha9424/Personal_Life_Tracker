import { beforeEach, describe, expect, it, vi } from 'vitest'
import { httpClient } from '@/shared/api/httpClient'
import type { Transaction, TransactionPage } from '../types'
import {
  bulkCreateTransactions,
  createTransaction,
  listAllTransactionsInRange,
  listCategories,
} from './financeApi'

vi.mock('@/shared/api/httpClient', () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const tx = (id: string): Transaction => ({
  id,
  kind: 'expense',
  amountMinor: 100,
  currency: 'USD',
  categoryId: 'c1',
  date: '2026-09-01',
  note: '',
})

const page = (items: Transaction[], pageNumber: number, total: number): TransactionPage => ({
  items,
  page: pageNumber,
  limit: 200,
  total,
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('financeApi', () => {
  it('unwraps the category list and passes the kind filter', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({
      data: { items: [{ id: 'c1', name: 'Food', kind: 'expense' }] },
    })

    await expect(listCategories('expense')).resolves.toEqual([
      { id: 'c1', name: 'Food', kind: 'expense' },
    ])
    expect(httpClient.get).toHaveBeenCalledWith('/categories', { params: { kind: 'expense' } })
  })

  it('sends the amount as the integer it was given, never a float', async () => {
    vi.mocked(httpClient.post).mockResolvedValue({ data: tx('t1') })
    const input = {
      kind: 'expense',
      amountMinor: 1234,
      categoryId: 'c1',
      date: '2026-09-01',
      note: '',
    } as const

    await createTransaction(input)

    expect(httpClient.post).toHaveBeenCalledWith('/transactions', input)
  })

  it('wraps a bulk import in { rows } and returns the created count', async () => {
    vi.mocked(httpClient.post).mockResolvedValue({ data: { created: 2 } })
    const rows = [tx('a'), tx('b')].map(({ kind, amountMinor, categoryId, date, note }) => ({
      kind,
      amountMinor,
      categoryId,
      date,
      note,
    }))

    await expect(bulkCreateTransactions(rows)).resolves.toEqual({ created: 2 })
    expect(httpClient.post).toHaveBeenCalledWith('/transactions/bulk', { rows })
  })

  it('collects every page of a date range, then stops', async () => {
    vi.mocked(httpClient.get)
      .mockResolvedValueOnce({ data: page([tx('a')], 1, 201) })
      .mockResolvedValueOnce({ data: page([tx('b')], 2, 201) })

    const found = await listAllTransactionsInRange('2026-09-01', '2026-09-30')

    expect(found.map((item) => item.id)).toEqual(['a', 'b'])
    expect(httpClient.get).toHaveBeenCalledTimes(2)
    expect(httpClient.get).toHaveBeenNthCalledWith(1, '/transactions', {
      params: { from: '2026-09-01', to: '2026-09-30', page: 1, limit: 200 },
    })
  })

  it('never asks for more than maxPages pages', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({ data: page([tx('a')], 1, 100_000) })

    await listAllTransactionsInRange('2026-09-01', '2026-09-30', 3)

    expect(httpClient.get).toHaveBeenCalledTimes(3)
  })

  it('stops at once when there is nothing in the range', async () => {
    vi.mocked(httpClient.get).mockResolvedValue({ data: page([], 1, 0) })

    await expect(listAllTransactionsInRange('2026-09-01', '2026-09-30')).resolves.toEqual([])
    expect(httpClient.get).toHaveBeenCalledTimes(1)
  })
})
