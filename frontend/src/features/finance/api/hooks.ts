import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getErrorMessage } from '@/shared/api/httpClient'
import { pushToast } from '@/shared/ui/toast'
import type { RangeMonths } from '../types'
import {
  bulkCreateTransactions,
  createCategory,
  createTransaction,
  deleteCategory,
  deleteTransaction,
  fetchBalanceTrend,
  fetchMonthlyTotals,
  fetchSpendingByCategory,
  fetchSummary,
  listCategories,
  listTransactions,
  renameCategory,
  updateTransaction,
  type ListTransactionsParams,
} from './financeApi'
import { financeKeys } from './financeKeys'

export function useCategories() {
  return useQuery({ queryKey: financeKeys.categories, queryFn: () => listCategories() })
}

export function useTransactions(params: ListTransactionsParams) {
  return useQuery({
    queryKey: financeKeys.transactions(params),
    queryFn: () => listTransactions(params),
    placeholderData: keepPreviousData,
  })
}

export function useMonthSummary(month: string) {
  return useQuery({ queryKey: financeKeys.summary(month), queryFn: () => fetchSummary(month) })
}

export function useSpendingByCategory(month: string) {
  return useQuery({
    queryKey: financeKeys.byCategory(month),
    queryFn: () => fetchSpendingByCategory(month),
  })
}

export function useMonthlyTotals(months: RangeMonths, to?: string) {
  return useQuery({
    queryKey: financeKeys.monthly(months, to),
    queryFn: () => fetchMonthlyTotals(months, to),
  })
}

export function useBalanceTrend(months: RangeMonths, to?: string) {
  return useQuery({
    queryKey: financeKeys.trend(months, to),
    queryFn: () => fetchBalanceTrend(months, to),
  })
}

/** Anything that changes money or category names changes every list, chart and total. */
function useInvalidateFinance() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: financeKeys.all })
}

export function useCreateTransaction() {
  return useMutation({ mutationFn: createTransaction, onSuccess: useInvalidateFinance() })
}

export function useUpdateTransaction() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTransaction>[1] }) =>
      updateTransaction(id, input),
    onSuccess: useInvalidateFinance(),
  })
}

export function useDeleteTransaction() {
  return useMutation({
    mutationFn: deleteTransaction,
    onSuccess: useInvalidateFinance(),
    onError: (error) =>
      pushToast(`Could not delete the transaction. ${getErrorMessage(error)}`, 'error'),
  })
}

export function useBulkCreateTransactions() {
  return useMutation({ mutationFn: bulkCreateTransactions, onSuccess: useInvalidateFinance() })
}

export function useCreateCategory() {
  return useMutation({ mutationFn: createCategory, onSuccess: useInvalidateFinance() })
}

export function useRenameCategory() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameCategory(id, name),
    onSuccess: useInvalidateFinance(),
  })
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: useInvalidateFinance(),
    onError: (error) =>
      pushToast(`Could not delete the category. ${getErrorMessage(error)}`, 'error'),
  })
}
