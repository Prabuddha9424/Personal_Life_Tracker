import { Types } from 'mongoose'
import { Category, type CategoryRecord } from './category.model.ts'
import {
  toCategoryDto,
  toTransactionDto,
  type CategoryDto,
  type TransactionDto,
} from './finance.dto.ts'
import { Transaction, type TransactionRecord } from './transaction.model.ts'

const OBJECT_ID = /^[a-f\d]{24}$/i

/**
 * The owner every query here is scoped to. An id that is not a full ObjectId is refused outright,
 * so a blank or malformed value can never turn into a filter that matches other users' rows.
 */
function ownerOf(userId: string): Types.ObjectId {
  if (!OBJECT_ID.test(userId)) throw new TypeError('A valid user id is required')
  return new Types.ObjectId(userId)
}

/** For the account export: every category and transaction, oldest transaction first. */
export async function exportFinance(
  userId: string,
): Promise<{ categories: CategoryDto[]; transactions: TransactionDto[] }> {
  const owner = ownerOf(userId)
  const [categories, transactions] = await Promise.all([
    Category.find({ userId: owner })
      .collation({ locale: 'en', strength: 2 })
      .sort({ kind: 1, name: 1 })
      .lean<CategoryRecord[]>(),
    Transaction.find({ userId: owner }).sort({ date: 1, _id: 1 }).lean<TransactionRecord[]>(),
  ])
  return {
    categories: categories.map(toCategoryDto),
    transactions: transactions.map(toTransactionDto),
  }
}

/** Removes every finance row of one user, for account deletion. */
export async function deleteAllFinance(userId: string): Promise<void> {
  const owner = ownerOf(userId)
  await Promise.all([
    Transaction.deleteMany({ userId: owner }),
    Category.deleteMany({ userId: owner }),
  ])
}

/** True when the user has at least one transaction; categories alone do not count. */
export async function hasTransactions(userId: string): Promise<boolean> {
  return (await Transaction.exists({ userId: ownerOf(userId) })) !== null
}
