import type { CategoryKind } from './category.model.ts'

const expense = (name: string) => ({ name, kind: 'expense' as CategoryKind })
const income = (name: string) => ({ name, kind: 'income' as CategoryKind })

/** Copied into a user's own rows the first time they open their categories. */
export const DEFAULT_CATEGORIES = [
  expense('Groceries'),
  expense('Dining out'),
  expense('Transport'),
  expense('Housing'),
  expense('Utilities'),
  expense('Health'),
  expense('Entertainment'),
  expense('Shopping'),
  expense('Education'),
  expense('Travel'),
  expense('Other'),
  income('Salary'),
  income('Freelance'),
  income('Investments'),
  income('Gifts'),
  income('Other'),
]
