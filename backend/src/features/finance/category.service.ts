import { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { isDuplicateKeyError } from '../../shared/errors/isDuplicateKeyError.ts'
import { CategorySeed } from './category-seed.model.ts'
import { Category, type CategoryKind, type CategoryRecord } from './category.model.ts'
import { DEFAULT_CATEGORIES } from './default-categories.ts'
import { toCategoryDto, type CategoryDto } from './finance.dto.ts'
import { Transaction } from './transaction.model.ts'

const MAX_CATEGORIES_PER_KIND = 100
const DUPLICATE_NAME = 'A category with that name already exists'

/**
 * Creates the default set the first time a user's categories are read. Safe to call concurrently.
 *
 * Every request that finds no marker inserts the whole set. The unique index turns the copies that
 * lose a race into duplicate-key failures, which are ignored, so the set exists exactly once. The
 * marker is written only after that, so any request that sees it also sees all the defaults.
 */
async function ensureDefaultCategories(owner: Types.ObjectId): Promise<void> {
  if (await CategorySeed.exists({ userId: owner })) return
  try {
    await Category.insertMany(
      DEFAULT_CATEGORIES.map((category) => ({ userId: owner, ...category })),
      { ordered: false },
    )
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
  }
  try {
    await CategorySeed.create({ userId: owner })
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
  }
}

export async function listCategories(userId: string, kind?: CategoryKind): Promise<CategoryDto[]> {
  const owner = new Types.ObjectId(userId)
  await ensureDefaultCategories(owner)
  const categories = await Category.find(kind ? { userId: owner, kind } : { userId: owner })
    .collation({ locale: 'en', strength: 2 })
    .sort({ kind: 1, name: 1 })
    .lean<CategoryRecord[]>()
  return categories.map(toCategoryDto)
}

export async function createCategory(
  userId: string,
  input: { name: string; kind: CategoryKind },
): Promise<CategoryDto> {
  const owner = new Types.ObjectId(userId)
  if (
    (await Category.countDocuments({ userId: owner, kind: input.kind })) >= MAX_CATEGORIES_PER_KIND
  ) {
    throw new AppError(
      409,
      `You can have at most ${MAX_CATEGORIES_PER_KIND} ${input.kind} categories`,
    )
  }
  try {
    const category = await Category.create({ userId: owner, ...input })
    return toCategoryDto(category.toObject<CategoryRecord>())
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new AppError(409, DUPLICATE_NAME)
    throw err
  }
}

export async function renameCategory(
  userId: string,
  id: string,
  name: string,
): Promise<CategoryDto> {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
      { $set: { name } },
      { returnDocument: 'after', runValidators: true },
    ).lean<CategoryRecord | null>()
    if (!category) throw new AppError(404, 'Category not found')
    return toCategoryDto(category)
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new AppError(409, DUPLICATE_NAME)
    throw err
  }
}

export async function deleteCategory(userId: string, id: string): Promise<void> {
  const owner = new Types.ObjectId(userId)
  const inUse = await Transaction.countDocuments({
    userId: owner,
    categoryId: new Types.ObjectId(id),
  })
  if (inUse > 0) {
    throw new AppError(
      409,
      `${inUse} ${inUse === 1 ? 'transaction uses' : 'transactions use'} this category. Reassign or delete ${inUse === 1 ? 'it' : 'them'} first.`,
    )
  }
  const result = await Category.deleteOne({ _id: new Types.ObjectId(id), userId: owner })
  if (result.deletedCount === 0) throw new AppError(404, 'Category not found')
}
