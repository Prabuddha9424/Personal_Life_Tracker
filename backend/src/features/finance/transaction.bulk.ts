import { Types } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { logger } from '../../shared/logger/logger.ts'
import { Category, type CategoryKind } from './category.model.ts'
import type { BulkTransactionsInput } from './finance.schemas.ts'
import { Transaction } from './transaction.model.ts'
import { requireProfile } from './transaction.service.ts'

/**
 * Inserts up to 500 rows, all or nothing: every row is checked against the user's categories
 * before anything is written, and if the insert itself fails part way the rows it did write are
 * removed again, best effort, and the original error always propagates (MongoDB does not make a
 * multi-document insert atomic on its own).
 */
export async function bulkCreateTransactions(
  userId: string,
  input: BulkTransactionsInput,
): Promise<{ created: number }> {
  const owner = new Types.ObjectId(userId)
  const profile = await requireProfile(userId)

  // Ids may arrive in upper-case hex; ObjectId normalises them to the form the lookup map uses.
  const rows = input.rows.map((row) => ({ ...row, categoryId: new Types.ObjectId(row.categoryId) }))
  const categories = await Category.find({
    _id: { $in: rows.map((row) => row.categoryId) },
    userId: owner,
  })
    .select('kind')
    .lean<{ _id: Types.ObjectId; kind: CategoryKind }[]>()
  const kindById = new Map(categories.map((category) => [category._id.toString(), category.kind]))

  for (const [index, row] of rows.entries()) {
    const kind = kindById.get(row.categoryId.toString())
    if (!kind) throw new AppError(400, `Row ${index + 1}: unknown category`)
    if (kind !== row.kind) throw new AppError(400, `Row ${index + 1}: that is an ${kind} category`)
  }

  const docs = rows.map((row) => ({
    _id: new Types.ObjectId(),
    userId: owner,
    kind: row.kind,
    amountMinor: row.amountMinor,
    currency: profile.currency,
    categoryId: row.categoryId,
    date: parseCalendarDate(row.date),
    note: row.note,
  }))

  try {
    await Transaction.insertMany(docs)
  } catch (err) {
    try {
      await Transaction.deleteMany({ _id: { $in: docs.map((doc) => doc._id) }, userId: owner })
    } catch (cleanupErr) {
      logger.error(
        { err: cleanupErr, rows: docs.length },
        'Bulk import failed and its partial rows could not be cleaned up',
      )
    }
    throw err
  }
  return { created: docs.length }
}
