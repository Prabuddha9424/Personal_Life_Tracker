import type { RangeMonths } from '../types'
import type { ListTransactionsParams } from './financeApi'

export const financeKeys = {
  all: ['finance'] as const,
  categories: ['finance', 'categories'] as const,
  transactions: (params: ListTransactionsParams) => ['finance', 'transactions', params] as const,
  summary: (month: string) => ['finance', 'summary', month] as const,
  byCategory: (month: string) => ['finance', 'by-category', month] as const,
  monthly: (months: RangeMonths, to?: string) =>
    ['finance', 'monthly', months, to ?? null] as const,
  trend: (months: RangeMonths, to?: string) => ['finance', 'trend', months, to ?? null] as const,
  existingInRange: (from: string, to: string) => ['finance', 'existing', from, to] as const,
}
