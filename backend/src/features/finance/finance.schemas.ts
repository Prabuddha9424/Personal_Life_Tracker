import { z } from 'zod'
import { currentMonth } from '../../shared/dates/calendarDate.ts'
import {
  calendarDateSchema,
  monthSchema,
  objectIdSchema,
  paginationQuerySchema,
} from '../../shared/validation/requestSchemas.ts'
import { CATEGORY_KINDS } from './category.model.ts'
import { MAX_AMOUNT_MINOR } from './transaction.model.ts'

/** The years finance reports cover, matching the month filters (a date outside them would never be reported). */
const reportableDateSchema = calendarDateSchema.refine((value) => {
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100
}, 'Expected a date between 2000 and 2100')

const nameSchema = z.string().trim().min(1, 'Name is required').max(40)
const kindSchema = z.enum(CATEGORY_KINDS)

export const categoryBodySchema = z.object({ name: nameSchema, kind: kindSchema })
export const renameCategorySchema = z.object({ name: nameSchema })
export const listCategoriesQuerySchema = z.object({ kind: kindSchema.optional() })

const transactionFields = {
  kind: kindSchema,
  amountMinor: z.number().int().min(1).max(MAX_AMOUNT_MINOR),
  categoryId: objectIdSchema,
  date: reportableDateSchema,
  note: z.string().trim().max(200),
}

export const createTransactionSchema = z.object({
  ...transactionFields,
  note: transactionFields.note.default(''),
})

export const updateTransactionSchema = z
  .object(transactionFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const bulkTransactionsSchema = z.object({
  rows: z.array(createTransactionSchema).min(1).max(500),
})

export const listTransactionsQuerySchema = paginationQuerySchema
  .extend({
    from: reportableDateSchema.optional(),
    to: reportableDateSchema.optional(),
    kind: kindSchema.optional(),
    categoryId: objectIdSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must not be after to',
    path: ['from'],
  })

export const monthQuerySchema = z.object({ month: monthSchema.default(() => currentMonth()) })

export const rangeQuerySchema = z.object({
  months: z.enum(['6', '12']).default('6').transform(Number),
  to: monthSchema.default(() => currentMonth()),
})

export type CategoryBody = z.infer<typeof categoryBodySchema>
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>
export type BulkTransactionsInput = z.infer<typeof bulkTransactionsSchema>
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>
export type MonthQuery = z.infer<typeof monthQuerySchema>
export type RangeQuery = z.infer<typeof rangeQuerySchema>
