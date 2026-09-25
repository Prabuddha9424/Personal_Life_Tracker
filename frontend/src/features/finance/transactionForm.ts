import { z } from 'zod'
import { todayIso } from '@/shared/lib/dates'
import {
  formatMinorForInput,
  isValidCurrencyCode,
  minorUnitDigits,
  toMinorUnits,
} from '@/shared/lib/money'
import type { Transaction, TransactionInput } from './types'

/** The server's limits on one amount (1 to 1e12 minor units) and on a reportable year. */
const MAX_MINOR = 1_000_000_000_000
const FIRST_YEAR = 2000
const LAST_YEAR = 2100

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && z.iso.date().safeParse(value).success
}

/**
 * `toMinorUnits` returns null for text that is well formed but does not fit a safe integer. That
 * is "too large", not "invalid", so the person is told what to fix.
 */
function isWellFormedPlainAmount(value: string, currency: string): boolean {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  return match !== null && (match[2]?.length ?? 0) <= minorUnitDigits(currency)
}

export function makeTransactionFormSchema(currency: string) {
  return z.object({
    kind: z.enum(['expense', 'income']),
    amount: z
      .string()
      .trim()
      .min(1, 'Enter an amount')
      .superRefine((value, context) => {
        if (value === '') return
        if (!isValidCurrencyCode(currency)) {
          context.addIssue({
            code: 'custom',
            message: 'Your profile currency is missing or invalid',
          })
          return
        }
        const minor = toMinorUnits(value, currency)
        if (minor === null) {
          context.addIssue({
            code: 'custom',
            message: isWellFormedPlainAmount(value, currency)
              ? 'Amount is too large'
              : `Enter a valid amount in ${currency}`,
          })
        } else if (minor === 0) {
          context.addIssue({ code: 'custom', message: 'Amount must be greater than zero' })
        } else if (minor > MAX_MINOR) {
          context.addIssue({ code: 'custom', message: 'Amount is too large' })
        }
      }),
    categoryId: z.string().min(1, 'Choose a category'),
    date: z
      .string()
      .refine(isCalendarDate, 'Choose a date')
      .refine((value) => {
        if (!isCalendarDate(value)) return true
        const year = Number(value.slice(0, 4))
        return year >= FIRST_YEAR && year <= LAST_YEAR
      }, `Choose a date between ${FIRST_YEAR} and ${LAST_YEAR}`),
    note: z.string().trim().max(200, 'Use at most 200 characters'),
  })
}

export type TransactionFormValues = z.infer<ReturnType<typeof makeTransactionFormSchema>>

/** Only for values the schema has already accepted; the fallback of 0 is never sent. */
export function toTransactionInput(
  values: TransactionFormValues,
  currency: string,
): TransactionInput {
  return {
    kind: values.kind,
    amountMinor: toMinorUnits(values.amount, currency) ?? 0,
    categoryId: values.categoryId,
    date: values.date,
    note: values.note.trim(),
  }
}

export function toFormValues(
  currency: string,
  transaction?: Transaction,
  today: string = todayIso(),
): TransactionFormValues {
  if (!transaction) {
    return { kind: 'expense', amount: '', categoryId: '', date: today, note: '' }
  }
  return {
    kind: transaction.kind,
    // Without a valid currency the scale is unknown, so leave the amount empty rather than guess.
    amount: isValidCurrencyCode(currency)
      ? formatMinorForInput(transaction.amountMinor, currency)
      : '',
    categoryId: transaction.categoryId,
    date: transaction.date,
    note: transaction.note,
  }
}
