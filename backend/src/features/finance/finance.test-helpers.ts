import { Types } from 'mongoose'
import { Category, type CategoryAttrs, type CategoryRecord } from './category.model.ts'
import { Transaction, type TransactionAttrs, type TransactionRecord } from './transaction.model.ts'

/** Inserts straight into the database, bypassing the API (for arranging test state). */
export async function insertCategory(
  userId: string,
  overrides: Partial<Omit<CategoryAttrs, 'userId'>> = {},
): Promise<CategoryRecord> {
  const category = await Category.create({
    userId: new Types.ObjectId(userId),
    name: `Category ${new Types.ObjectId().toString().slice(-6)}`,
    kind: 'expense',
    ...overrides,
  })
  return category.toObject<CategoryRecord>()
}

/** Creates a matching category first when no categoryId is given. `date` is a YYYY-MM-DD string. */
export async function insertTransaction(
  userId: string,
  overrides: Partial<Omit<TransactionAttrs, 'userId' | 'date'>> & { date?: string } = {},
): Promise<TransactionRecord> {
  const { date = '2026-09-15', ...rest } = overrides
  const kind = rest.kind ?? 'expense'
  const categoryId = rest.categoryId ?? (await insertCategory(userId, { kind }))._id
  const tx = await Transaction.create({
    userId: new Types.ObjectId(userId),
    kind,
    amountMinor: 1000,
    currency: 'USD',
    note: '',
    ...rest,
    categoryId,
    date: new Date(`${date}T00:00:00.000Z`),
  })
  return tx.toObject<TransactionRecord>()
}
