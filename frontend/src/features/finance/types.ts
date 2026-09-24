export type TransactionKind = 'income' | 'expense'

export type RangeMonths = 6 | 12

export interface Category {
  id: string
  name: string
  kind: TransactionKind
}

export interface Transaction {
  id: string
  kind: TransactionKind
  amountMinor: number
  currency: string
  categoryId: string
  /** YYYY-MM-DD */
  date: string
  note: string
}

export interface TransactionPage {
  items: Transaction[]
  page: number
  limit: number
  total: number
}

export interface TransactionFilters {
  from?: string
  to?: string
  kind?: TransactionKind
  categoryId?: string
}

export interface TransactionInput {
  kind: TransactionKind
  amountMinor: number
  categoryId: string
  date: string
  note: string
}

export interface MonthSummary {
  month: string
  currency: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export interface CategorySpend {
  categoryId: string
  name: string
  totalMinor: number
}

export interface SpendingByCategory {
  month: string
  currency: string
  items: CategorySpend[]
}

export interface MonthlyItem {
  month: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export interface MonthlyTotals {
  currency: string
  items: MonthlyItem[]
}

export interface BalanceTrend {
  currency: string
  openingMinor: number
  items: { month: string; balanceMinor: number }[]
}
