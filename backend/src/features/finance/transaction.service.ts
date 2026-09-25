import { Types, type QueryFilter, type UpdateQuery } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { paginated, toSkip, type Paginated } from '../../shared/validation/requestSchemas.ts'
import { getUserProfile, type UserProfile } from '../auth/index.ts'
import { Category, type CategoryKind } from './category.model.ts'
import { toTransactionDto, type TransactionDto } from './finance.dto.ts'
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './finance.schemas.ts'
import { Transaction, type TransactionAttrs, type TransactionRecord } from './transaction.model.ts'

/** The signed-in user's profile. A deleted account's still-valid token gets 401 here. */
export async function requireProfile(userId: string): Promise<UserProfile> {
  const profile = await getUserProfile(userId)
  if (!profile) throw new AppError(401, 'Not authorized')
  return profile
}

/**
 * The category must belong to the user and match the transaction's kind. Another user's category
 * answers exactly like one that does not exist.
 */
async function assertCategoryMatches(
  owner: Types.ObjectId,
  categoryId: string,
  kind: CategoryKind,
): Promise<void> {
  const category = await Category.findOne({ _id: new Types.ObjectId(categoryId), userId: owner })
    .select('kind')
    .lean<{ kind: CategoryKind } | null>()
  if (!category) throw new AppError(400, 'Unknown category')
  if (category.kind !== kind) throw new AppError(400, `That is an ${category.kind} category`)
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
): Promise<TransactionDto> {
  const owner = new Types.ObjectId(userId)
  const profile = await requireProfile(userId)
  await assertCategoryMatches(owner, input.categoryId, input.kind)

  const tx = await Transaction.create({
    userId: owner,
    kind: input.kind,
    amountMinor: input.amountMinor,
    currency: profile.currency,
    categoryId: new Types.ObjectId(input.categoryId),
    date: parseCalendarDate(input.date),
    note: input.note,
  })
  return toTransactionDto(tx.toObject<TransactionRecord>())
}

export async function listTransactions(
  userId: string,
  query: ListTransactionsQuery,
): Promise<Paginated<TransactionDto>> {
  const filter: QueryFilter<TransactionAttrs> = { userId: new Types.ObjectId(userId) }
  if (query.kind) filter.kind = query.kind
  if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId)
  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: parseCalendarDate(query.from) } : {}),
      ...(query.to ? { $lte: parseCalendarDate(query.to) } : {}),
    }
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip(toSkip(query))
      .limit(query.limit)
      .lean<TransactionRecord[]>(),
    Transaction.countDocuments(filter),
  ])
  return paginated(items.map(toTransactionDto), total, query)
}

export async function updateTransaction(
  userId: string,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionDto> {
  const owner = new Types.ObjectId(userId)
  const scope = { _id: new Types.ObjectId(id), userId: owner }
  const current = await Transaction.findOne(scope).lean<TransactionRecord | null>()
  if (!current) throw new AppError(404, 'Transaction not found')

  const set: UpdateQuery<TransactionAttrs>['$set'] = {}
  if (input.kind !== undefined) set.kind = input.kind
  if (input.amountMinor !== undefined) set.amountMinor = input.amountMinor
  if (input.categoryId !== undefined) set.categoryId = new Types.ObjectId(input.categoryId)
  if (input.date !== undefined) set.date = parseCalendarDate(input.date)
  if (input.note !== undefined) set.note = input.note

  const changesCategoryOrKind = input.kind !== undefined || input.categoryId !== undefined
  if (changesCategoryOrKind) {
    await assertCategoryMatches(
      owner,
      input.categoryId ?? current.categoryId.toString(),
      input.kind ?? current.kind,
    )
  }

  // The write is scoped by owner and, when the kind or category changes, by the kind and category the
  // transaction had when it was read, so a concurrent change to those makes it fail with 409 instead
  // of pairing them wrongly. The NEW target category is only checked above, not pinned to the write:
  // deleting it in between can still leave a stale reference.
  const updated = await Transaction.findOneAndUpdate(
    changesCategoryOrKind
      ? { ...scope, kind: current.kind, categoryId: current.categoryId }
      : scope,
    { $set: set },
    { returnDocument: 'after', runValidators: true },
  ).lean<TransactionRecord | null>()
  if (!updated) throw new AppError(409, 'The transaction changed while it was being updated')
  return toTransactionDto(updated)
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  const result = await Transaction.deleteOne({
    _id: new Types.ObjectId(id),
    userId: new Types.ObjectId(userId),
  })
  if (result.deletedCount === 0) throw new AppError(404, 'Transaction not found')
}
