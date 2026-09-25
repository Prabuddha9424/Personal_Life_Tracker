import { httpClient } from '@/shared/api/httpClient'
import type {
  BalanceTrend,
  Category,
  MonthlyTotals,
  MonthSummary,
  RangeMonths,
  SpendingByCategory,
  Transaction,
  TransactionFilters,
  TransactionInput,
  TransactionKind,
  TransactionPage,
} from '../types'

export async function listCategories(kind?: TransactionKind): Promise<Category[]> {
  const { data } = await httpClient.get<{ items: Category[] }>('/categories', { params: { kind } })
  return data.items
}

export async function createCategory(input: {
  name: string
  kind: TransactionKind
}): Promise<Category> {
  const { data } = await httpClient.post<Category>('/categories', input)
  return data
}

export async function renameCategory(id: string, name: string): Promise<Category> {
  const { data } = await httpClient.patch<Category>(`/categories/${id}`, { name })
  return data
}

export async function deleteCategory(id: string): Promise<void> {
  await httpClient.delete(`/categories/${id}`)
}

export interface ListTransactionsParams extends TransactionFilters {
  page?: number
  limit?: number
}

export async function listTransactions(params: ListTransactionsParams): Promise<TransactionPage> {
  const { data } = await httpClient.get<TransactionPage>('/transactions', { params })
  return data
}

/**
 * The transactions in a date range, up to `maxPages` pages of 200, in the order the API lists them.
 * `truncated` is true when the range holds more than were read. Used to spot duplicates.
 */
export async function listAllTransactionsInRange(
  from: string,
  to: string,
  maxPages = 5,
): Promise<{ items: Transaction[]; truncated: boolean }> {
  const items: Transaction[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listTransactions({ from, to, page, limit: 200 })
    items.push(...result.items)
    if (page * result.limit >= result.total) return { items, truncated: false }
  }
  return { items, truncated: true }
}

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  const { data } = await httpClient.post<Transaction>('/transactions', input)
  return data
}

export async function updateTransaction(
  id: string,
  input: Partial<TransactionInput>,
): Promise<Transaction> {
  const { data } = await httpClient.patch<Transaction>(`/transactions/${id}`, input)
  return data
}

export async function deleteTransaction(id: string): Promise<void> {
  await httpClient.delete(`/transactions/${id}`)
}

/** Creates up to 500 rows, all or nothing: one bad row rejects the batch, and its "Row N" counts from 1 within the batch sent, not the file. */
export async function bulkCreateTransactions(
  rows: TransactionInput[],
): Promise<{ created: number }> {
  const { data } = await httpClient.post<{ created: number }>('/transactions/bulk', { rows })
  return data
}

export async function fetchSummary(month: string): Promise<MonthSummary> {
  const { data } = await httpClient.get<MonthSummary>('/finance/summary', { params: { month } })
  return data
}

export async function fetchSpendingByCategory(month: string): Promise<SpendingByCategory> {
  const { data } = await httpClient.get<SpendingByCategory>('/finance/by-category', {
    params: { month },
  })
  return data
}

export async function fetchMonthlyTotals(months: RangeMonths): Promise<MonthlyTotals> {
  const { data } = await httpClient.get<MonthlyTotals>('/finance/monthly', { params: { months } })
  return data
}

export async function fetchBalanceTrend(months: RangeMonths): Promise<BalanceTrend> {
  const { data } = await httpClient.get<BalanceTrend>('/finance/trend', { params: { months } })
  return data
}
