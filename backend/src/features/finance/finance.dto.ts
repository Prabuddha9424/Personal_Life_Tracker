import { formatCalendarDate } from '../../shared/dates/calendarDate.ts'
import type { CategoryKind, CategoryRecord } from './category.model.ts'
import type { TransactionRecord } from './transaction.model.ts'

export interface CategoryDto {
  id: string
  name: string
  kind: CategoryKind
}

export interface TransactionDto {
  id: string
  kind: CategoryKind
  amountMinor: number
  currency: string
  categoryId: string
  date: string
  note: string
}

export function toCategoryDto(category: CategoryRecord): CategoryDto {
  return { id: category._id.toString(), name: category.name, kind: category.kind }
}

export function toTransactionDto(tx: TransactionRecord): TransactionDto {
  return {
    id: tx._id.toString(),
    kind: tx.kind,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    categoryId: tx.categoryId.toString(),
    date: formatCalendarDate(tx.date),
    note: tx.note,
  }
}
