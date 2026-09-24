import { z } from 'zod'

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

export const idParamsSchema = z.object({ id: objectIdSchema })

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** A real calendar date as `YYYY-MM-DD`. */
export const calendarDateSchema = z.iso.date()

/** A calendar month as `YYYY-MM`. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')
  .refine((value) => {
    const year = Number(value.slice(0, 4))
    return year >= 2000 && year <= 2100
  }, 'Expected a month between 2000 and 2100')

interface PageArgs {
  page: number
  limit: number
}

export interface Paginated<T> {
  items: T[]
  page: number
  limit: number
  total: number
}

export function toSkip({ page, limit }: PageArgs): number {
  return (page - 1) * limit
}

export function paginated<T>(items: T[], total: number, { page, limit }: PageArgs): Paginated<T> {
  return { items, page, limit, total }
}
