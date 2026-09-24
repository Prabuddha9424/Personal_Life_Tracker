# M3 Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0, M1 and M2 must be merged.

**Goal:** Track income and expenses with categories, see four charts (summary cards, spending doughnut, income-vs-expenses bars, balance trend line), and bulk-import transactions from a CSV.

**Architecture:** Backend slice `features/finance` with three sub-routers (categories, transactions, reports) composed by one `financeRouter`, plus a small public API. Money is integer minor units; the user's currency comes from the auth slice's public `getUserProfile`. Reports use MongoDB aggregations whose `$match` always starts with an `ObjectId` `userId`. Frontend slice `features/finance` with TanStack Query hooks, Chart.js charts (with a hidden data table for accessibility), a transaction list and form, a category manager and a CSV import dialog whose parser and mapper are pure, tested functions.

**Tech Stack:** Express 5, Mongoose 9 (aggregation), Zod 4; React 19, Chart.js 4 + react-chartjs-2, TanStack Query, React Hook Form + Zod. No new dependencies (CSV parsing is in-repo, PRD Q4).

**Spec:** [`../PRD.md`](../PRD.md) FIN-1 to FIN-10, NFR-1, NFR-6, NFR-8.

## Global Constraints

- Money is an **integer in minor units** plus a currency code: `amountMinor` is an integer from 1 to 1 000 000 000 000; never a float in storage, in the API or in sums. Floating-point division is allowed only for display and chart plotting (`minorToMajor`).
- Dates are `YYYY-MM-DD` on the wire and UTC midnight in Mongo. Months are `YYYY-MM` (UTC).
- Every query, **including every aggregation `$match`**, includes `userId` as a `Types.ObjectId` (an aggregation does not cast a string). Look up by `{ _id, userId }`. Never trust a `userId` from the client.
- Index `userId` and the common filters: `{ userId, date: -1 }`, `{ userId, categoryId }`, `{ userId, kind, date: -1 }`, and a unique `{ userId, kind, name }` on categories.
- The `finance` slice reaches the auth slice only through `import { getUserProfile } from '../auth/index.ts'`.
- Paginate list endpoints, use `.lean()` for reads, validate everything with Zod through `validate`.
- Category deletion is refused (`409`) while transactions use it.
- Every data view has loading, empty and error states; every chart has an accessible text alternative; charts are readable in both themes.
- Work on branch `feature/finance-charts`. Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Lint, typecheck and tests must pass before each commit.

## Review Focus

1. **Aggregations must not leak across users.** A `$match` with a string `userId` silently matches nothing; one without `userId` matches everyone. Two users with data in the same month must each see only their own totals, and totals must be non-zero (proving the match works). [Task 5 and 6 tests]
2. **Month boundaries.** A transaction on the 30th/31st and one on the 1st of the next month land in different months; a six-month window ending in February spans the year boundary. [Task 5 tests]
3. **Currencies with 0 and 3 decimals.** JPY `500` and BHD `1.234` must round-trip through the form, storage and the charts. [Task 3 test, Task 9 and 10 tests]
4. **Category integrity.** A category cannot be deleted while used, cannot be renamed to a duplicate (case-insensitive), and a transaction's category must belong to the user and match the transaction's kind. Concurrent first requests must not create duplicate default categories. [Tasks 2, 3, 4 tests]
5. **CSV edge cases.** Quoted commas, doubled quotes, embedded newlines, CRLF, a BOM, blank lines, semicolon and tab delimiters, a header-only file, and unparseable rows (reported per line, never silently dropped). [Task 8 tests]
6. **Deleted category in a report.** A transaction whose category no longer exists still counts in totals and shows as "Deleted category". [Task 5 test]

---

## Part A: Backend

### Task 1: Models, schemas, DTOs and test helpers

**Files:**
- Create: `backend/src/features/finance/category.model.ts`, `transaction.model.ts`, `default-categories.ts`, `finance.dto.ts`, `finance.schemas.ts`, `finance.test-helpers.ts`

**Interfaces:**
- Produces: `Category` model, `CategoryKind = 'income' | 'expense'`, `type CategoryAttrs`, `type CategoryRecord`; `Transaction` model, `type TransactionAttrs`, `type TransactionRecord`; `DEFAULT_CATEGORIES: { name: string; kind: CategoryKind }[]`; `CategoryDto`, `TransactionDto`, `toCategoryDto`, `toTransactionDto`; schemas `categoryBodySchema`, `renameCategorySchema`, `listCategoriesQuerySchema`, `createTransactionSchema`, `updateTransactionSchema`, `bulkTransactionsSchema`, `listTransactionsQuerySchema`, `monthQuerySchema`, `rangeQuerySchema` with inferred input types; test helpers `insertCategory(userId, overrides?)`, `insertTransaction(userId, overrides?)`.

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/finance-charts
```

- [ ] **Step 1: Write the models**

`backend/src/features/finance/category.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'

export const CATEGORY_KINDS = ['income', 'expense'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export interface CategoryAttrs {
  userId: Types.ObjectId
  name: string
  kind: CategoryKind
}

export type CategoryRecord = CategoryAttrs & { _id: Types.ObjectId }

const categorySchema = new Schema<CategoryAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  kind: { type: String, enum: CATEGORY_KINDS, required: true },
})

// Names are unique per user and kind, ignoring case ("Food" and "food" are the same category).
categorySchema.index(
  { userId: 1, kind: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
)

export const Category = model<CategoryAttrs>('Category', categorySchema)
```

`backend/src/features/finance/transaction.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'
import { CATEGORY_KINDS, type CategoryKind } from './category.model.ts'

export const MAX_AMOUNT_MINOR = 1_000_000_000_000

export interface TransactionAttrs {
  userId: Types.ObjectId
  kind: CategoryKind
  /** Positive integer in the currency's minor unit (cents). The kind carries the sign. */
  amountMinor: number
  /** ISO 4217 code, copied from the user's profile when the transaction is created. */
  currency: string
  categoryId: Types.ObjectId
  /** UTC midnight of the calendar day. */
  date: Date
  note: string
}

export type TransactionRecord = TransactionAttrs & { _id: Types.ObjectId }

const transactionSchema = new Schema<TransactionAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: CATEGORY_KINDS, required: true },
  amountMinor: {
    type: Number,
    required: true,
    min: 1,
    max: MAX_AMOUNT_MINOR,
    validate: { validator: Number.isInteger, message: 'amountMinor must be an integer' },
  },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  date: { type: Date, required: true },
  note: { type: String, default: '', maxlength: 200 },
})

transactionSchema.index({ userId: 1, date: -1 })
transactionSchema.index({ userId: 1, categoryId: 1 })
transactionSchema.index({ userId: 1, kind: 1, date: -1 })

export const Transaction = model<TransactionAttrs>('Transaction', transactionSchema)
```

- [ ] **Step 2: Write the defaults, DTOs and schemas**

`backend/src/features/finance/default-categories.ts`:

```ts
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
```

`backend/src/features/finance/finance.dto.ts`:

```ts
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
```

`backend/src/features/finance/finance.schemas.ts`:

```ts
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

const nameSchema = z.string().trim().min(1, 'Name is required').max(40)
const kindSchema = z.enum(CATEGORY_KINDS)

export const categoryBodySchema = z.object({ name: nameSchema, kind: kindSchema })
export const renameCategorySchema = z.object({ name: nameSchema })
export const listCategoriesQuerySchema = z.object({ kind: kindSchema.optional() })

const transactionFields = {
  kind: kindSchema,
  amountMinor: z.number().int().min(1).max(MAX_AMOUNT_MINOR),
  categoryId: objectIdSchema,
  date: calendarDateSchema,
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
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
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
```

- [ ] **Step 3: Write the test helpers**

`backend/src/features/finance/finance.test-helpers.ts`:

```ts
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
```

- [ ] **Step 4: Run all checks and commit**

```bash
cd backend && npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add category and transaction models, schemas and DTOs" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Category endpoints with lazy default categories

**Files:**
- Create: `backend/src/features/finance/category.service.ts`, `category.controller.ts`, `category.routes.ts`, `finance.routes.ts`, `index.ts`, `category.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Produces: `listCategories(userId, kind?): Promise<CategoryDto[]>` (creates the default set on first use), `createCategory(userId, body)`, `renameCategory(userId, id, name)`, `deleteCategory(userId, id)`; routes `GET/POST /api/categories`, `PATCH/DELETE /api/categories/:id`; `financeRouter` (mounted at `/api`).

- [ ] **Step 1: Write the failing tests**

`backend/src/features/finance/category.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { DEFAULT_CATEGORIES } from './default-categories.ts'
import { insertTransaction } from './finance.test-helpers.ts'

vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({ id, email: `${id}@example.com`, name: 'Test', currency: 'USD' }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const list = (query = '', user = alice) => request(app).get(`/api/categories${query}`).set(user.headers)
const create = (body: object, user = alice) =>
  request(app).post('/api/categories').set(user.headers).send(body)

describe('GET /api/categories', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/categories').expect(401)
  })

  it('creates the default set on first use and returns it', async () => {
    const res = await list()

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(DEFAULT_CATEGORIES.length)
    expect(res.body.items[0]).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      name: expect.any(String),
      kind: expect.stringMatching(/^(income|expense)$/),
    })
    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('does not create the defaults twice, even when requests race', async () => {
    await Promise.all([list(), list(), list()])

    expect(await Category.countDocuments({ userId: alice.id })).toBe(DEFAULT_CATEGORIES.length)
  })

  it('filters by kind', async () => {
    const income = await list('?kind=income')
    const expense = await list('?kind=expense')

    expect(income.body.items.every((c: { kind: string }) => c.kind === 'income')).toBe(true)
    expect(expense.body.items.every((c: { kind: string }) => c.kind === 'expense')).toBe(true)
    expect(income.body.items.length + expense.body.items.length).toBe(DEFAULT_CATEGORIES.length)
  })

  it('rejects an unknown kind', async () => {
    await list('?kind=transfer').expect(400)
  })
})

describe('POST /api/categories', () => {
  it('creates a category', async () => {
    const res = await create({ name: '  Pets  ', kind: 'expense' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Pets', kind: 'expense' })
  })

  it('refuses a duplicate name of the same kind, ignoring case, but allows it for the other kind', async () => {
    await create({ name: 'Pets', kind: 'expense' }).expect(201)

    const duplicate = await create({ name: 'pets', kind: 'expense' })
    const otherKind = await create({ name: 'Pets', kind: 'income' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({ message: 'A category with that name already exists' })
    expect(otherKind.status).toBe(201)
  })

  it.each([
    ['a blank name', { name: '  ', kind: 'expense' }],
    ['a 41-character name', { name: 'x'.repeat(41), kind: 'expense' }],
    ['an unknown kind', { name: 'x', kind: 'transfer' }],
    ['no kind', { name: 'x' }],
  ])('rejects %s', async (_name, body) => {
    await create(body).expect(400)
  })

  it('keeps the same name separate between users', async () => {
    await create({ name: 'Pets', kind: 'expense' }).expect(201)

    await create({ name: 'Pets', kind: 'expense' }, testUser()).expect(201)
  })
})

describe('PATCH /api/categories/:id', () => {
  const rename = (id: string, name: string) =>
    request(app).patch(`/api/categories/${id}`).set(alice.headers).send({ name })

  it('renames a category', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })

    const res = await rename(body.id, 'Animals')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: body.id, name: 'Animals', kind: 'expense' })
  })

  it('refuses a name that another category of the same kind already has', async () => {
    await create({ name: 'Pets', kind: 'expense' })
    const { body } = await create({ name: 'Animals', kind: 'expense' })

    await rename(body.id, 'PETS').expect(409)
  })

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    await rename('65f1c2a4b3d4e5f6a7b8c9d0', 'x').expect(404)
    await rename('nope', 'x').expect(400)
  })
})

describe('DELETE /api/categories/:id', () => {
  it('deletes an unused category', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })

    await request(app).delete(`/api/categories/${body.id}`).set(alice.headers).expect(204)

    expect(await Category.countDocuments({ _id: body.id })).toBe(0)
  })

  it('refuses to delete a category that transactions use, and says how many', async () => {
    const { body } = await create({ name: 'Pets', kind: 'expense' })
    await insertTransaction(alice.id, { categoryId: body.id })
    await insertTransaction(alice.id, { categoryId: body.id })

    const res = await request(app).delete(`/api/categories/${body.id}`).set(alice.headers)

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/2 transactions/)
    expect(await Category.countDocuments({ _id: body.id })).toBe(1)
  })

  it('answers 404 for an unknown category', async () => {
    await request(app).delete('/api/categories/65f1c2a4b3d4e5f6a7b8c9d0').set(alice.headers).expect(404)
  })
})
```

Run: `npx vitest run src/features/finance/category.test.ts` → FAIL (404 on `/api/categories`; the transaction model is imported but the routes are missing).

The `vi.mock('../auth/index.ts', ...)` line replaces the auth slice's public API for finance tests. Finance tests must not need a real user row, and only `getUserProfile` is used.

- [ ] **Step 2: Implement the category service**

`backend/src/features/finance/category.service.ts`:

```ts
import { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { Category, type CategoryKind, type CategoryRecord } from './category.model.ts'
import { DEFAULT_CATEGORIES } from './default-categories.ts'
import { toCategoryDto, type CategoryDto } from './finance.dto.ts'
import { Transaction } from './transaction.model.ts'

const DUPLICATE_NAME = 'A category with that name already exists'

const isDuplicateCode = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'code' in value && value.code === 11000

/** A single duplicate-key error, or a bulk insert whose only failures were duplicates. */
function isDuplicateKeyError(err: unknown): boolean {
  if (isDuplicateCode(err)) return true
  if (typeof err !== 'object' || err === null || !('writeErrors' in err)) return false
  const failures: unknown = err.writeErrors
  return Array.isArray(failures) && failures.length > 0 && failures.every(isDuplicateCode)
}

/** Creates the default set the first time a user has no categories. Safe to call concurrently. */
async function ensureDefaultCategories(owner: Types.ObjectId): Promise<void> {
  if (await Category.exists({ userId: owner })) return
  try {
    await Category.insertMany(
      DEFAULT_CATEGORIES.map((category) => ({ userId: owner, ...category })),
      { ordered: false },
    )
  } catch (err) {
    // A parallel first request got there first; the unique index rejected our copies.
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
  try {
    const category = await Category.create({ userId: new Types.ObjectId(userId), ...input })
    return toCategoryDto(category.toObject<CategoryRecord>())
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new AppError(409, DUPLICATE_NAME)
    throw err
  }
}

export async function renameCategory(userId: string, id: string, name: string): Promise<CategoryDto> {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { name } },
      { new: true, runValidators: true },
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
  const inUse = await Transaction.countDocuments({ userId: owner, categoryId: id })
  if (inUse > 0) {
    throw new AppError(
      409,
      `${inUse} ${inUse === 1 ? 'transaction uses' : 'transactions use'} this category. Reassign or delete ${inUse === 1 ? 'it' : 'them'} first.`,
    )
  }
  const result = await Category.deleteOne({ _id: id, userId: owner })
  if (result.deletedCount === 0) throw new AppError(404, 'Category not found')
}
```

The test regex `/2 transactions/` matches "2 transactions use this category…" as written.

- [ ] **Step 3: Implement controller, routes and the slice entry**

`backend/src/features/finance/category.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import * as categoryService from './category.service.ts'
import type { CategoryBody, ListCategoriesQuery } from './finance.schemas.ts'

export async function list(req: Request, res: Response) {
  const { kind } = req.query as unknown as ListCategoriesQuery
  res.json({ items: await categoryService.listCategories(authUserId(req), kind) })
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await categoryService.createCategory(authUserId(req), req.body as CategoryBody))
}

export async function rename(req: Request, res: Response) {
  const { name } = req.body as { name: string }
  res.json(await categoryService.renameCategory(authUserId(req), req.params.id as string, name))
}

export async function remove(req: Request, res: Response) {
  await categoryService.deleteCategory(authUserId(req), req.params.id as string)
  res.status(204).end()
}
```

`backend/src/features/finance/category.routes.ts`:

```ts
import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import { create, list, remove, rename } from './category.controller.ts'
import {
  categoryBodySchema,
  listCategoriesQuerySchema,
  renameCategorySchema,
} from './finance.schemas.ts'

export const categoryRouter = Router()

categoryRouter.get('/', validate({ query: listCategoriesQuerySchema }), list)
categoryRouter.post('/', validate({ body: categoryBodySchema }), create)
categoryRouter.patch('/:id', validate({ params: idParamsSchema, body: renameCategorySchema }), rename)
categoryRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
```

`backend/src/features/finance/finance.routes.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { categoryRouter } from './category.routes.ts'

/**
 * Mounted at /api. requireAuth is attached per path, never with router.use('/'), so it cannot
 * intercept other slices' routes such as /api/auth/login.
 */
export const financeRouter = Router()

financeRouter.use('/categories', requireAuth, categoryRouter)
```

`backend/src/features/finance/index.ts`:

```ts
export { financeRouter } from './finance.routes.ts'
```

In `backend/src/app.ts` add `import { financeRouter } from './features/finance/index.ts'` and mount it after the tasks router: `app.use('/api', financeRouter)`.

Run: `npx vitest run src/features/finance/category.test.ts` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add category endpoints with lazily created defaults" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Transaction CRUD and list

**Files:**
- Create: `backend/src/features/finance/transaction.service.ts`, `transaction.controller.ts`, `transaction.routes.ts`, `transaction.test.ts`
- Modify: `backend/src/features/finance/finance.routes.ts`

**Interfaces:**
- Consumes: `getUserProfile` from `../auth/index.ts`, the models and schemas.
- Produces: `createTransaction(userId, input): Promise<TransactionDto>`, `listTransactions(userId, query): Promise<Paginated<TransactionDto>>`, `updateTransaction(userId, id, input)`, `deleteTransaction(userId, id)`, `requireProfile(userId): Promise<UserProfile>` (throws 401 for a deleted user); routes `GET/POST /api/transactions`, `PATCH/DELETE /api/transactions/:id`.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/finance/transaction.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: profiles.get(id) ?? 'USD',
  }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const create = (body: object, user = alice) =>
  request(app).post('/api/transactions').set(user.headers).send(body)
const list = (query = '', user = alice) =>
  request(app).get(`/api/transactions${query}`).set(user.headers)

async function body(overrides: object = {}, user = alice) {
  const category = await insertCategory(user.id, { kind: 'expense' })
  return {
    kind: 'expense',
    amountMinor: 1250,
    categoryId: category._id.toString(),
    date: '2026-09-15',
    note: 'Lunch',
    ...overrides,
  }
}

describe('POST /api/transactions', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/transactions').send({}).expect(401)
  })

  it('creates a transaction in the user\'s currency', async () => {
    const res = await create(await body())

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      kind: 'expense',
      amountMinor: 1250,
      currency: 'USD',
      categoryId: expect.any(String),
      date: '2026-09-15',
      note: 'Lunch',
    })
  })

  it('stores integer minor units for currencies with no or three decimals', async () => {
    const yen = testUser()
    const dinar = testUser()
    profiles.set(yen.id, 'JPY')
    profiles.set(dinar.id, 'BHD')

    const jpy = await create(await body({ amountMinor: 500 }, yen), yen)
    const bhd = await create(await body({ amountMinor: 1234 }, dinar), dinar)

    expect(jpy.body).toMatchObject({ amountMinor: 500, currency: 'JPY' })
    expect(bhd.body).toMatchObject({ amountMinor: 1234, currency: 'BHD' })
    expect((await Transaction.findById(jpy.body.id))?.amountMinor).toBe(500)
  })

  it('defaults the note to empty and stores the date at UTC midnight', async () => {
    const res = await create(await body({ note: undefined }))

    expect(res.body.note).toBe('')
    expect((await Transaction.findById(res.body.id))?.date.toISOString()).toBe('2026-09-15T00:00:00.000Z')
  })

  it.each([
    ['a zero amount', { amountMinor: 0 }],
    ['a negative amount', { amountMinor: -5 }],
    ['a fractional amount', { amountMinor: 12.5 }],
    ['an amount over the limit', { amountMinor: 1_000_000_000_001 }],
    ['an amount sent as a string', { amountMinor: '1250' }],
    ['an impossible date', { date: '2026-02-30' }],
    ['a date with a time', { date: '2026-02-03T10:00:00Z' }],
    ['a long note', { note: 'x'.repeat(201) }],
    ['an unknown kind', { kind: 'transfer' }],
    ['a malformed category id', { categoryId: 'nope' }],
  ])('rejects %s with 400', async (_name, override) => {
    const res = await create(await body(override))

    expect(res.status).toBe(400)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it("rejects another user's category and one that does not exist, with the same answer", async () => {
    const bob = testUser()
    const bobsCategory = await insertCategory(bob.id, { kind: 'expense' })

    const foreign = await create(await body({ categoryId: bobsCategory._id.toString() }))
    const missing = await create(await body({ categoryId: '65f1c2a4b3d4e5f6a7b8c9d0' }))

    expect(foreign.status).toBe(400)
    expect(foreign.body).toEqual({ message: 'Unknown category' })
    expect(missing.body).toEqual(foreign.body)
  })

  it("rejects a category of the other kind", async () => {
    const income = await insertCategory(alice.id, { kind: 'income' })

    const res = await create(await body({ kind: 'expense', categoryId: income._id.toString() }))

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/income category/)
  })

  it('ignores a client-supplied userId and currency', async () => {
    const bob = testUser()

    const res = await create({ ...(await body()), userId: bob.id, currency: 'EUR' })

    const stored = await Transaction.findById(res.body.id)
    expect(stored?.userId.toString()).toBe(alice.id)
    expect(stored?.currency).toBe('USD')
  })
})

describe('GET /api/transactions', () => {
  it('returns an empty page for a user with no transactions', async () => {
    const res = await list()

    expect(res.body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
  })

  it('lists newest first', async () => {
    await insertTransaction(alice.id, { date: '2026-09-01', note: 'old' })
    await insertTransaction(alice.id, { date: '2026-09-20', note: 'new' })
    await insertTransaction(alice.id, { date: '2026-09-10', note: 'middle' })

    const res = await list()

    expect(res.body.items.map((t: { note: string }) => t.note)).toEqual(['new', 'middle', 'old'])
  })

  it('filters by date range (inclusive), kind and category', async () => {
    const groceries = await insertCategory(alice.id, { kind: 'expense', name: 'Groceries' })
    await insertTransaction(alice.id, { date: '2026-09-01', note: 'a', categoryId: groceries._id })
    await insertTransaction(alice.id, { date: '2026-09-15', note: 'b' })
    await insertTransaction(alice.id, { date: '2026-09-30', note: 'c', kind: 'income' })

    const notes = async (query: string) =>
      (await list(query)).body.items.map((t: { note: string }) => t.note).sort()

    expect(await notes('?from=2026-09-15&to=2026-09-30')).toEqual(['b', 'c'])
    expect(await notes('?kind=income')).toEqual(['c'])
    expect(await notes(`?categoryId=${groceries._id.toString()}`)).toEqual(['a'])
  })

  it('paginates and reports the total', async () => {
    for (let day = 1; day <= 5; day += 1) {
      await insertTransaction(alice.id, { date: `2026-09-0${day}`, note: `d${day}` })
    }

    const res = await list('?limit=2&page=2')

    expect(res.body.items.map((t: { note: string }) => t.note)).toEqual(['d3', 'd2'])
    expect(res.body).toMatchObject({ page: 2, limit: 2, total: 5 })
  })

  it.each(['?from=2026-09-30&to=2026-09-01', '?limit=201', '?kind=transfer', '?from=nope'])(
    'rejects %s',
    async (query) => {
      await list(query).expect(400)
    },
  )
})

describe('PATCH /api/transactions/:id', () => {
  const patch = (id: string, payload: object) =>
    request(app).patch(`/api/transactions/${id}`).set(alice.headers).send(payload)

  it('updates only the given fields', async () => {
    const tx = await insertTransaction(alice.id, { note: 'keep', amountMinor: 100 })

    const res = await patch(tx._id.toString(), { amountMinor: 999, date: '2026-10-01' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ amountMinor: 999, date: '2026-10-01', note: 'keep' })
  })

  it('checks the category against the kind when either changes', async () => {
    const tx = await insertTransaction(alice.id, { kind: 'expense' })
    const income = await insertCategory(alice.id, { kind: 'income' })

    await patch(tx._id.toString(), { categoryId: income._id.toString() }).expect(400)
    await patch(tx._id.toString(), { kind: 'income' }).expect(400)
    await patch(tx._id.toString(), { kind: 'income', categoryId: income._id.toString() }).expect(200)
  })

  it('rejects an empty update and answers 404 for an unknown id', async () => {
    const tx = await insertTransaction(alice.id)

    await patch(tx._id.toString(), {}).expect(400)
    await patch('65f1c2a4b3d4e5f6a7b8c9d0', { note: 'x' }).expect(404)
  })

  it('does not change the currency', async () => {
    const tx = await insertTransaction(alice.id, { currency: 'EUR' })

    const res = await patch(tx._id.toString(), { note: 'changed' })

    expect(res.body.currency).toBe('EUR')
  })
})

describe('DELETE /api/transactions/:id', () => {
  it('deletes with 204 and then answers 404', async () => {
    const tx = await insertTransaction(alice.id)

    await request(app).delete(`/api/transactions/${tx._id.toString()}`).set(alice.headers).expect(204)

    await request(app).delete(`/api/transactions/${tx._id.toString()}`).set(alice.headers).expect(404)
  })
})
```

Run → FAIL (404 on `/api/transactions`).

- [ ] **Step 2: Implement the service**

`backend/src/features/finance/transaction.service.ts`:

```ts
import { Types, type QueryFilter } from 'mongoose'
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

/** The category must belong to the user and match the transaction's kind. */
export async function assertCategoryMatches(
  owner: Types.ObjectId,
  categoryId: string,
  kind: CategoryKind,
): Promise<void> {
  const category = await Category.findOne({ _id: categoryId, userId: owner })
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
  const tx = await Transaction.findOne({ _id: id, userId: owner })
  if (!tx) throw new AppError(404, 'Transaction not found')

  if (input.kind !== undefined || input.categoryId !== undefined) {
    await assertCategoryMatches(owner, input.categoryId ?? tx.categoryId.toString(), input.kind ?? tx.kind)
  }
  if (input.kind !== undefined) tx.kind = input.kind
  if (input.amountMinor !== undefined) tx.amountMinor = input.amountMinor
  if (input.categoryId !== undefined) tx.categoryId = new Types.ObjectId(input.categoryId)
  if (input.date !== undefined) tx.date = parseCalendarDate(input.date)
  if (input.note !== undefined) tx.note = input.note

  await tx.save()
  return toTransactionDto(tx.toObject<TransactionRecord>())
}

export async function deleteTransaction(userId: string, id: string): Promise<void> {
  const result = await Transaction.deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (result.deletedCount === 0) throw new AppError(404, 'Transaction not found')
}
```

- [ ] **Step 3: Controller, routes, wiring**

`backend/src/features/finance/transaction.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './finance.schemas.ts'
import * as transactionService from './transaction.service.ts'

export async function list(req: Request, res: Response) {
  res.json(
    await transactionService.listTransactions(authUserId(req), req.query as unknown as ListTransactionsQuery),
  )
}

export async function create(req: Request, res: Response) {
  res
    .status(201)
    .json(await transactionService.createTransaction(authUserId(req), req.body as CreateTransactionInput))
}

export async function update(req: Request, res: Response) {
  res.json(
    await transactionService.updateTransaction(
      authUserId(req),
      req.params.id as string,
      req.body as UpdateTransactionInput,
    ),
  )
}

export async function remove(req: Request, res: Response) {
  await transactionService.deleteTransaction(authUserId(req), req.params.id as string)
  res.status(204).end()
}
```

`backend/src/features/finance/transaction.routes.ts`:

```ts
import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './finance.schemas.ts'
import { create, list, remove, update } from './transaction.controller.ts'

export const transactionRouter = Router()

transactionRouter.get('/', validate({ query: listTransactionsQuerySchema }), list)
transactionRouter.post('/', validate({ body: createTransactionSchema }), create)
transactionRouter.patch('/:id', validate({ params: idParamsSchema, body: updateTransactionSchema }), update)
transactionRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
```

In `finance.routes.ts` add `import { transactionRouter } from './transaction.routes.ts'` and, after the categories line:

```ts
financeRouter.use('/transactions', requireAuth, transactionRouter)
```

Run: `npx vitest run src/features/finance` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add transaction CRUD and filtered, paginated list" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Bulk import endpoint

**Files:**
- Create: `backend/src/features/finance/transaction.bulk.ts`, `transaction.bulk.test.ts`
- Modify: `backend/src/features/finance/transaction.controller.ts`, `transaction.routes.ts`

**Interfaces:**
- Produces: `bulkCreateTransactions(userId, input: BulkTransactionsInput): Promise<{ created: number }>`; route `POST /api/transactions/bulk` (`201 { created }`). The whole request is validated first and inserted only if every row is valid (all or nothing). Row errors name the row: `Row 3: unknown category`.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/finance/transaction.bulk.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertCategory } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: profiles.get(id) ?? 'USD',
  }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterEach(() => {
  profiles.clear()
})
afterAll(stopTestDb)

const alice = testUser()
const bulk = (rows: unknown, user = alice) =>
  request(app).post('/api/transactions/bulk').set(user.headers).send({ rows })

async function setup() {
  const food = await insertCategory(alice.id, { kind: 'expense', name: 'Food' })
  const pay = await insertCategory(alice.id, { kind: 'income', name: 'Pay' })
  const row = (overrides: object = {}) => ({
    kind: 'expense',
    amountMinor: 500,
    categoryId: food._id.toString(),
    date: '2026-09-01',
    note: 'x',
    ...overrides,
  })
  return { food, pay, row }
}

describe('POST /api/transactions/bulk', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/transactions/bulk').send({ rows: [] }).expect(401)
  })

  it('creates every row, in the user\'s currency, and reports the count', async () => {
    const { pay, row } = await setup()
    profiles.set(alice.id, 'EUR')

    const res = await bulk([
      row(),
      row({ note: 'y', amountMinor: 700 }),
      row({ kind: 'income', categoryId: pay._id.toString(), amountMinor: 90000 }),
    ])

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ created: 3 })
    const stored = await Transaction.find({ userId: alice.id })
    expect(stored).toHaveLength(3)
    expect(stored.every((tx) => tx.currency === 'EUR')).toBe(true)
  })

  it('stores nothing when any row has an unknown category, and names the row', async () => {
    const { row } = await setup()

    const res = await bulk([row(), row(), row({ categoryId: '65f1c2a4b3d4e5f6a7b8c9d0' })])

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Row 3: unknown category' })
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it("rejects another user's category and a category of the wrong kind", async () => {
    const { pay, row } = await setup()
    const bobsCategory = await insertCategory(testUser().id, { kind: 'expense' })

    const foreign = await bulk([row({ categoryId: bobsCategory._id.toString() })])
    const wrongKind = await bulk([row(), row({ categoryId: pay._id.toString() })])

    expect(foreign.body).toEqual({ message: 'Row 1: unknown category' })
    expect(wrongKind.body).toEqual({ message: 'Row 2: that is an income category' })
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it.each([
    ['no rows', []],
    ['more than 500 rows', Array.from({ length: 501 }, () => ({}))],
    ['a row with a fractional amount', [{ kind: 'expense', amountMinor: 1.5, categoryId: '65f1c2a4b3d4e5f6a7b8c9d0', date: '2026-09-01' }]],
    ['rows that are not an array', 'nope'],
  ])('rejects %s with 400', async (_name, rows) => {
    const res = await bulk(rows)

    expect(res.status).toBe(400)
    expect(await Transaction.countDocuments()).toBe(0)
  })

  it('accepts exactly 500 rows', async () => {
    const { row } = await setup()

    const res = await bulk(Array.from({ length: 500 }, (_, i) => row({ note: `n${i}` })))

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ created: 500 })
  })

  it('ignores a userId inside a row', async () => {
    const { row } = await setup()
    const bob = testUser()

    await bulk([row({ userId: bob.id })]).expect(201)

    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(0)
    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(1)
  })
})
```

Run → FAIL (404 or 400 because `/bulk` matches `/:id`-less routes; the route does not exist yet).

- [ ] **Step 2: Implement**

`backend/src/features/finance/transaction.bulk.ts`:

```ts
import { Types } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { Category, type CategoryKind } from './category.model.ts'
import type { BulkTransactionsInput } from './finance.schemas.ts'
import { Transaction } from './transaction.model.ts'
import { requireProfile } from './transaction.service.ts'

/**
 * Inserts up to 500 rows, all or nothing: every row is checked against the user's categories
 * before anything is written.
 */
export async function bulkCreateTransactions(
  userId: string,
  input: BulkTransactionsInput,
): Promise<{ created: number }> {
  const owner = new Types.ObjectId(userId)
  const profile = await requireProfile(userId)

  const categoryIds = [...new Set(input.rows.map((row) => row.categoryId))]
  const categories = await Category.find({ _id: { $in: categoryIds }, userId: owner })
    .select('kind')
    .lean<{ _id: Types.ObjectId; kind: CategoryKind }[]>()
  const kindById = new Map(categories.map((category) => [category._id.toString(), category.kind]))

  for (const [index, row] of input.rows.entries()) {
    const kind = kindById.get(row.categoryId)
    if (!kind) throw new AppError(400, `Row ${index + 1}: unknown category`)
    if (kind !== row.kind) throw new AppError(400, `Row ${index + 1}: that is an ${kind} category`)
  }

  await Transaction.insertMany(
    input.rows.map((row) => ({
      userId: owner,
      kind: row.kind,
      amountMinor: row.amountMinor,
      currency: profile.currency,
      categoryId: new Types.ObjectId(row.categoryId),
      date: parseCalendarDate(row.date),
      note: row.note,
    })),
  )
  return { created: input.rows.length }
}
```

In `transaction.controller.ts` add `import { bulkCreateTransactions } from './transaction.bulk.ts'`, `BulkTransactionsInput` to the schema type import, and:

```ts
export async function bulk(req: Request, res: Response) {
  res.status(201).json(await bulkCreateTransactions(authUserId(req), req.body as BulkTransactionsInput))
}
```

In `transaction.routes.ts` import `bulk` and `bulkTransactionsSchema` and add, **before** the `/:id` routes:

```ts
transactionRouter.post('/bulk', validate({ body: bulkTransactionsSchema }), bulk)
```

Run: `npx vitest run src/features/finance/transaction.bulk.test.ts` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add all-or-nothing bulk transaction import" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Reports (summary, by category, monthly totals, balance trend)

**Files:**
- Create: `backend/src/features/finance/report.service.ts`, `report.controller.ts`, `report.routes.ts`, `report.test.ts`
- Modify: `backend/src/features/finance/finance.routes.ts`

**Interfaces:**
- Produces: `monthSummary(userId, month)`, `spendingByCategory(userId, month)`, `monthlyTotals(userId, months, to)`, `balanceTrend(userId, months, to)`; routes `GET /api/finance/summary`, `/by-category`, `/monthly`, `/trend` with the response shapes in the overview.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/finance/report.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: profiles.get(id) ?? 'USD',
  }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
const get = (url: string, user = alice) => request(app).get(url).set(user.headers)

/** Alice's data (and bob's, in the same months, which must never leak in). */
async function seed() {
  const groceries = await insertCategory(alice.id, { kind: 'expense', name: 'Groceries' })
  const transport = await insertCategory(alice.id, { kind: 'expense', name: 'Transport' })
  const salary = await insertCategory(alice.id, { kind: 'income', name: 'Salary' })
  const tx = (date: string, kind: 'income' | 'expense', amountMinor: number, categoryId: typeof salary._id) =>
    insertTransaction(alice.id, { date, kind, amountMinor, categoryId })

  await tx('2026-09-01', 'expense', 5000, groceries._id)
  await tx('2026-09-30', 'expense', 2500, groceries._id)
  await tx('2026-09-15', 'expense', 1200, transport._id)
  await tx('2026-09-25', 'income', 300000, salary._id)
  await tx('2026-08-31', 'expense', 4000, groceries._id)
  await tx('2026-08-25', 'income', 300000, salary._id)
  await tx('2026-10-01', 'expense', 999, groceries._id)
  await tx('2025-01-10', 'income', 10000, salary._id)

  await insertTransaction(bob.id, { date: '2026-09-10', kind: 'income', amountMinor: 111111 })
  await insertTransaction(bob.id, { date: '2026-09-11', kind: 'expense', amountMinor: 77777 })
  return { groceries, transport, salary }
}

beforeEach(() => {
  profiles.clear()
})

describe('GET /api/finance/summary', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/finance/summary').expect(401)
  })

  it("totals the user's month and nothing else", async () => {
    await seed()

    const res = await get('/api/finance/summary?month=2026-09')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      month: '2026-09',
      currency: 'USD',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })
  })

  it('puts the 30th and the 1st in different months', async () => {
    await seed()

    const august = await get('/api/finance/summary?month=2026-08')
    const october = await get('/api/finance/summary?month=2026-10')

    expect(august.body).toMatchObject({ incomeMinor: 300000, expenseMinor: 4000 })
    expect(october.body).toMatchObject({ incomeMinor: 0, expenseMinor: 999, netMinor: -999 })
  })

  it('returns zeros for an empty month and defaults to the current month', async () => {
    const empty = await get('/api/finance/summary?month=2020-01')
    const current = await get('/api/finance/summary')

    expect(empty.body).toMatchObject({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
    expect(current.body.month).toMatch(/^\d{4}-\d{2}$/)
  })

  it("reports the user's currency", async () => {
    profiles.set(alice.id, 'JPY')

    const res = await get('/api/finance/summary?month=2026-09')

    expect(res.body.currency).toBe('JPY')
  })

  it('keeps two users with data in the same month apart', async () => {
    await seed()

    const bobs = await get('/api/finance/summary?month=2026-09', bob)

    expect(bobs.body).toMatchObject({ incomeMinor: 111111, expenseMinor: 77777, netMinor: 33334 })
  })

  it.each(['?month=2026-13', '?month=2026-9', '?month=2026-09-01', '?month=september'])(
    'rejects %s',
    async (query) => {
      await get(`/api/finance/summary${query}`).expect(400)
    },
  )
})

describe('GET /api/finance/by-category', () => {
  it('groups expenses by category, largest first, with names', async () => {
    const { groceries, transport } = await seed()

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body).toEqual({
      month: '2026-09',
      currency: 'USD',
      items: [
        { categoryId: groceries._id.toString(), name: 'Groceries', totalMinor: 7500 },
        { categoryId: transport._id.toString(), name: 'Transport', totalMinor: 1200 },
      ],
    })
  })

  it('leaves income out', async () => {
    await seed()

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body.items.map((item: { name: string }) => item.name)).not.toContain('Salary')
  })

  it('still counts a transaction whose category was deleted', async () => {
    const { groceries } = await seed()
    await Category.deleteOne({ _id: groceries._id })

    const res = await get('/api/finance/by-category?month=2026-09')

    expect(res.body.items[0]).toEqual({
      categoryId: groceries._id.toString(),
      name: 'Deleted category',
      totalMinor: 7500,
    })
  })

  it("never includes another user's spending", async () => {
    await seed()

    const bobs = await get('/api/finance/by-category?month=2026-09', bob)

    expect(bobs.body.items).toHaveLength(1)
    expect(bobs.body.items[0].totalMinor).toBe(77777)
  })
})

describe('GET /api/finance/monthly', () => {
  it('returns six months, oldest first, filling empty months with zeros', async () => {
    await seed()

    const res = await get('/api/finance/monthly?months=6&to=2026-09')

    expect(res.body.currency).toBe('USD')
    expect(res.body.items.map((item: { month: string }) => item.month)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
    expect(res.body.items[0]).toEqual({ month: '2026-04', incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
    expect(res.body.items[4]).toEqual({
      month: '2026-08',
      incomeMinor: 300000,
      expenseMinor: 4000,
      netMinor: 296000,
    })
    expect(res.body.items[5]).toEqual({
      month: '2026-09',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })
  })

  it('spans the year boundary', async () => {
    const res = await get('/api/finance/monthly?months=6&to=2026-02')

    expect(res.body.items.map((item: { month: string }) => item.month)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })

  it('supports twelve months and defaults to six', async () => {
    const twelve = await get('/api/finance/monthly?months=12&to=2026-09')
    const defaults = await get('/api/finance/monthly?to=2026-09')

    expect(twelve.body.items).toHaveLength(12)
    expect(defaults.body.items).toHaveLength(6)
  })

  it.each(['?months=7', '?months=0', '?to=2026-13'])('rejects %s', async (query) => {
    await get(`/api/finance/monthly${query}`).expect(400)
  })

  it("does not include another user's months", async () => {
    await seed()

    const bobs = await get('/api/finance/monthly?months=6&to=2026-09', bob)

    expect(bobs.body.items[5]).toMatchObject({ incomeMinor: 111111, expenseMinor: 77777 })
    expect(bobs.body.items[4]).toMatchObject({ incomeMinor: 0, expenseMinor: 0 })
  })
})

describe('GET /api/finance/trend', () => {
  it('starts from the balance before the window and adds each month\'s net', async () => {
    await seed()

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body).toEqual({
      currency: 'USD',
      openingMinor: 10000,
      items: [
        { month: '2026-04', balanceMinor: 10000 },
        { month: '2026-05', balanceMinor: 10000 },
        { month: '2026-06', balanceMinor: 10000 },
        { month: '2026-07', balanceMinor: 10000 },
        { month: '2026-08', balanceMinor: 306000 },
        { month: '2026-09', balanceMinor: 597300 },
      ],
    })
  })

  it('has a zero opening balance and flat line for a user with no data', async () => {
    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.openingMinor).toBe(0)
    expect(res.body.items.every((item: { balanceMinor: number }) => item.balanceMinor === 0)).toBe(true)
  })

  it("does not count another user's opening balance", async () => {
    await insertTransaction(bob.id, { date: '2020-01-01', kind: 'income', amountMinor: 555 })

    const res = await get('/api/finance/trend?months=6&to=2026-09')

    expect(res.body.openingMinor).toBe(0)
  })
})
```

Run: `npx vitest run src/features/finance/report.test.ts` → FAIL (404).

- [ ] **Step 2: Implement the report service**

`backend/src/features/finance/report.service.ts`:

```ts
import { Types, type PipelineStage } from 'mongoose'
import { monthRange, shiftMonth } from '../../shared/dates/calendarDate.ts'
import { Category, type CategoryKind } from './category.model.ts'
import { Transaction } from './transaction.model.ts'
import { requireProfile } from './transaction.service.ts'

interface KindTotal {
  _id: CategoryKind
  total: number
}

interface Totals {
  income: number
  expense: number
}

/**
 * Every pipeline starts with a $match on userId as an ObjectId. Aggregations do not cast, so a
 * string userId would silently match nothing, and omitting it would match every user.
 */
function dateMatch(owner: Types.ObjectId, start: Date | null, end: Date): PipelineStage.Match {
  return { $match: { userId: owner, date: start ? { $gte: start, $lt: end } : { $lt: end } } }
}

async function totalsBetween(owner: Types.ObjectId, start: Date | null, end: Date): Promise<Totals> {
  const rows = await Transaction.aggregate<KindTotal>([
    dateMatch(owner, start, end),
    { $group: { _id: '$kind', total: { $sum: '$amountMinor' } } },
  ])
  const totals: Totals = { income: 0, expense: 0 }
  for (const row of rows) totals[row._id] = row.total
  return totals
}

export async function monthSummary(userId: string, month: string) {
  const owner = new Types.ObjectId(userId)
  const { start, end } = monthRange(month)
  const [profile, totals] = await Promise.all([requireProfile(userId), totalsBetween(owner, start, end)])
  return {
    month,
    currency: profile.currency,
    incomeMinor: totals.income,
    expenseMinor: totals.expense,
    netMinor: totals.income - totals.expense,
  }
}

export async function spendingByCategory(userId: string, month: string) {
  const owner = new Types.ObjectId(userId)
  const { start, end } = monthRange(month)

  const [profile, rows] = await Promise.all([
    requireProfile(userId),
    Transaction.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { userId: owner, kind: 'expense', date: { $gte: start, $lt: end } } },
      { $group: { _id: '$categoryId', total: { $sum: '$amountMinor' } } },
      { $sort: { total: -1, _id: 1 } },
    ]),
  ])
  const categories = await Category.find({ _id: { $in: rows.map((row) => row._id) }, userId: owner })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>()
  const nameById = new Map(categories.map((category) => [category._id.toString(), category.name]))

  return {
    month,
    currency: profile.currency,
    items: rows.map((row) => ({
      categoryId: row._id.toString(),
      name: nameById.get(row._id.toString()) ?? 'Deleted category',
      totalMinor: row.total,
    })),
  }
}

/** The `count` months ending at `to`, oldest first. */
function monthsEndingAt(to: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(to, index - (count - 1)))
}

async function monthlyTotals(owner: Types.ObjectId, to: string, count: number) {
  const start = monthRange(shiftMonth(to, -(count - 1))).start
  const { end } = monthRange(to)

  const rows = await Transaction.aggregate<{ _id: { month: string; kind: CategoryKind }; total: number }>([
    dateMatch(owner, start, end),
    {
      $group: {
        _id: { month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' } }, kind: '$kind' },
        total: { $sum: '$amountMinor' },
      },
    },
  ])

  const byMonth = new Map<string, Totals>()
  for (const row of rows) {
    const totals = byMonth.get(row._id.month) ?? { income: 0, expense: 0 }
    totals[row._id.kind] = row.total
    byMonth.set(row._id.month, totals)
  }

  return monthsEndingAt(to, count).map((month) => {
    const totals = byMonth.get(month) ?? { income: 0, expense: 0 }
    return {
      month,
      incomeMinor: totals.income,
      expenseMinor: totals.expense,
      netMinor: totals.income - totals.expense,
    }
  })
}

export async function monthlyReport(userId: string, count: number, to: string) {
  const owner = new Types.ObjectId(userId)
  const [profile, items] = await Promise.all([requireProfile(userId), monthlyTotals(owner, to, count)])
  return { currency: profile.currency, items }
}

export async function balanceTrend(userId: string, count: number, to: string) {
  const owner = new Types.ObjectId(userId)
  const windowStart = monthRange(shiftMonth(to, -(count - 1))).start

  const [profile, items, before] = await Promise.all([
    requireProfile(userId),
    monthlyTotals(owner, to, count),
    totalsBetween(owner, null, windowStart),
  ])

  const openingMinor = before.income - before.expense
  let balance = openingMinor
  return {
    currency: profile.currency,
    openingMinor,
    items: items.map((item) => {
      balance += item.netMinor
      return { month: item.month, balanceMinor: balance }
    }),
  }
}
```

- [ ] **Step 3: Controller, routes, wiring**

`backend/src/features/finance/report.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { MonthQuery, RangeQuery } from './finance.schemas.ts'
import * as reportService from './report.service.ts'

export async function summary(req: Request, res: Response) {
  const { month } = req.query as unknown as MonthQuery
  res.json(await reportService.monthSummary(authUserId(req), month))
}

export async function byCategory(req: Request, res: Response) {
  const { month } = req.query as unknown as MonthQuery
  res.json(await reportService.spendingByCategory(authUserId(req), month))
}

export async function monthly(req: Request, res: Response) {
  const { months, to } = req.query as unknown as RangeQuery
  res.json(await reportService.monthlyReport(authUserId(req), months, to))
}

export async function trend(req: Request, res: Response) {
  const { months, to } = req.query as unknown as RangeQuery
  res.json(await reportService.balanceTrend(authUserId(req), months, to))
}
```

`backend/src/features/finance/report.routes.ts`:

```ts
import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.ts'
import { monthQuerySchema, rangeQuerySchema } from './finance.schemas.ts'
import { byCategory, monthly, summary, trend } from './report.controller.ts'

export const reportRouter = Router()

reportRouter.get('/summary', validate({ query: monthQuerySchema }), summary)
reportRouter.get('/by-category', validate({ query: monthQuerySchema }), byCategory)
reportRouter.get('/monthly', validate({ query: rangeQuerySchema }), monthly)
reportRouter.get('/trend', validate({ query: rangeQuerySchema }), trend)
```

In `finance.routes.ts` import `reportRouter` and add:

```ts
financeRouter.use('/finance', requireAuth, reportRouter)
```

Run: `npx vitest run src/features/finance/report.test.ts` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add summary, category, monthly and balance-trend reports" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Tenant isolation and the slice's public API

**Files:**
- Create: `backend/src/features/finance/finance.data.ts`, `finance.isolation.test.ts`, `finance.public-api.test.ts`
- Modify: `backend/src/features/finance/index.ts`

**Interfaces:**
- Produces (from `features/finance/index.ts`): `financeRouter`, `type CategoryDto`, `type TransactionDto`, `exportFinanceForUser(userId): Promise<{ categories: CategoryDto[]; transactions: TransactionDto[] }>`, `deleteFinanceForUser(userId): Promise<void>`, `hasFinanceDataForUser(userId): Promise<boolean>` (true when the user has at least one transaction; categories alone do not count).

- [ ] **Step 1: Write the isolation test (NFR-1)**

`backend/src/features/finance/finance.isolation.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({ id, email: `${id}@example.com`, name: 'Test', currency: 'USD' }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
let aliceCategory: string
let aliceTransaction: string

beforeEach(async () => {
  const category = await insertCategory(alice.id, { kind: 'expense', name: 'Alice private' })
  const tx = await insertTransaction(alice.id, { categoryId: category._id, note: 'alice secret' })
  aliceCategory = category._id.toString()
  aliceTransaction = tx._id.toString()
})

const asBob = {
  get: (url: string) => request(app).get(url).set(bob.headers),
  patch: (url: string, body: object) => request(app).patch(url).set(bob.headers).send(body),
  delete: (url: string) => request(app).delete(url).set(bob.headers),
  post: (url: string, body: object) => request(app).post(url).set(bob.headers).send(body),
}

describe("another user's finance data looks like it does not exist", () => {
  it('transactions cannot be changed or deleted by id', async () => {
    await asBob.patch(`/api/transactions/${aliceTransaction}`, { note: 'hacked' }).expect(404)
    await asBob.delete(`/api/transactions/${aliceTransaction}`).expect(404)

    expect((await Transaction.findById(aliceTransaction))?.note).toBe('alice secret')
  })

  it('categories cannot be renamed or deleted by id', async () => {
    await asBob.patch(`/api/categories/${aliceCategory}`, { name: 'hacked' }).expect(404)
    await asBob.delete(`/api/categories/${aliceCategory}`).expect(404)

    expect((await Category.findById(aliceCategory))?.name).toBe('Alice private')
  })

  it('lists, filters and category lists never include them', async () => {
    const transactions = await asBob.get('/api/transactions')
    const byCategory = await asBob.get(`/api/transactions?categoryId=${aliceCategory}`)
    const categories = await asBob.get('/api/categories')

    expect(transactions.body.total).toBe(0)
    expect(byCategory.body.total).toBe(0)
    expect(categories.body.items.map((c: { name: string }) => c.name)).not.toContain('Alice private')
  })

  it("cannot be used as bob's transaction category, single or bulk", async () => {
    const row = { kind: 'expense', amountMinor: 100, categoryId: aliceCategory, date: '2026-09-01' }

    await asBob.post('/api/transactions', row).expect(400)
    await asBob.post('/api/transactions/bulk', { rows: [row] }).expect(400)

    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(0)
  })

  it("cannot move bob's transaction into alice's category", async () => {
    const bobsCategory = await insertCategory(bob.id, { kind: 'expense' })
    const bobsTransaction = await insertTransaction(bob.id, { categoryId: bobsCategory._id })

    await asBob
      .patch(`/api/transactions/${bobsTransaction._id.toString()}`, { categoryId: aliceCategory })
      .expect(400)
  })

  it('cannot be created for someone else by sending their user id', async () => {
    const bobsCategory = await insertCategory(bob.id, { kind: 'expense' })

    const res = await asBob.post('/api/transactions', {
      kind: 'expense',
      amountMinor: 100,
      categoryId: bobsCategory._id.toString(),
      date: '2026-09-01',
      userId: alice.id,
    })

    expect((await Transaction.findById(res.body.id))?.userId.toString()).toBe(bob.id)
    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(1)
  })

  it('never shows up in reports', async () => {
    for (const path of ['summary', 'by-category']) {
      const res = await asBob.get(`/api/finance/${path}?month=2026-09`)
      expect(JSON.stringify(res.body)).not.toContain('Alice private')
    }
    const summary = await asBob.get('/api/finance/summary?month=2026-09')
    expect(summary.body).toMatchObject({ incomeMinor: 0, expenseMinor: 0 })
  })
})
```

Run: `npx vitest run src/features/finance/finance.isolation.test.ts`. It should PASS. If any assertion fails it is a tenant leak; fix the service, never the test.

- [ ] **Step 2: Write the public API test**

`backend/src/features/finance/finance.public-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { Category } from './category.model.ts'
import { insertCategory, insertTransaction } from './finance.test-helpers.ts'
import { deleteFinanceForUser, exportFinanceForUser, hasFinanceDataForUser } from './index.ts'
import { Transaction } from './transaction.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('finance public API', () => {
  it('reports whether a user has transactions; categories alone do not count', async () => {
    const alice = testUser()
    const bob = testUser()
    await insertCategory(alice.id)
    await insertTransaction(bob.id)

    expect(await hasFinanceDataForUser(alice.id)).toBe(false)
    expect(await hasFinanceDataForUser(bob.id)).toBe(true)
  })

  it("exports only the user's own categories and transactions", async () => {
    const alice = testUser()
    const bob = testUser()
    const groceries = await insertCategory(alice.id, { name: 'Groceries' })
    await insertTransaction(alice.id, { categoryId: groceries._id, date: '2026-09-02', note: 'later' })
    await insertTransaction(alice.id, { categoryId: groceries._id, date: '2026-09-01', note: 'earlier' })
    await insertTransaction(bob.id, { note: 'not yours' })

    const exported = await exportFinanceForUser(alice.id)

    expect(exported.categories.map((c) => c.name)).toEqual(['Groceries'])
    expect(exported.transactions.map((t) => t.note)).toEqual(['earlier', 'later'])
    expect(exported.transactions[0]).toMatchObject({ date: '2026-09-01', kind: 'expense', currency: 'USD' })
  })

  it("deletes all of one user's finance data and leaves everyone else's", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertTransaction(alice.id)
    await insertTransaction(bob.id)

    await deleteFinanceForUser(alice.id)

    expect(await Transaction.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Category.countDocuments({ userId: alice.id })).toBe(0)
    expect(await Transaction.countDocuments({ userId: bob.id })).toBe(1)
    expect(await Category.countDocuments({ userId: bob.id })).toBe(1)
  })
})
```

- [ ] **Step 3: Implement and export**

`backend/src/features/finance/finance.data.ts`:

```ts
import { Types } from 'mongoose'
import { Category, type CategoryRecord } from './category.model.ts'
import { toCategoryDto, toTransactionDto, type CategoryDto, type TransactionDto } from './finance.dto.ts'
import { Transaction, type TransactionRecord } from './transaction.model.ts'

/** For the account export: every category and transaction, oldest transaction first. */
export async function exportFinance(
  userId: string,
): Promise<{ categories: CategoryDto[]; transactions: TransactionDto[] }> {
  const owner = new Types.ObjectId(userId)
  const [categories, transactions] = await Promise.all([
    Category.find({ userId: owner }).sort({ kind: 1, name: 1 }).lean<CategoryRecord[]>(),
    Transaction.find({ userId: owner }).sort({ date: 1, _id: 1 }).lean<TransactionRecord[]>(),
  ])
  return { categories: categories.map(toCategoryDto), transactions: transactions.map(toTransactionDto) }
}

export async function deleteAllFinance(userId: string): Promise<void> {
  const owner = new Types.ObjectId(userId)
  await Promise.all([Transaction.deleteMany({ userId: owner }), Category.deleteMany({ userId: owner })])
}

export async function hasTransactions(userId: string): Promise<boolean> {
  return (await Transaction.exists({ userId: new Types.ObjectId(userId) })) !== null
}
```

Replace `backend/src/features/finance/index.ts`:

```ts
export {
  deleteAllFinance as deleteFinanceForUser,
  exportFinance as exportFinanceForUser,
  hasTransactions as hasFinanceDataForUser,
} from './finance.data.ts'
export { financeRouter } from './finance.routes.ts'
export type { CategoryDto, TransactionDto } from './finance.dto.ts'
```

Run: `npx vitest run src/features/finance` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(finance): add tenant isolation tests and the slice public API" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B: Frontend

All commands in Part B run from `frontend/`. Imports use `@/`; imports inside `features/finance` are relative. Components that need the user's currency call `useSessionUser` from `@/features/auth` (the slice's public API); their tests replace that module with `vi.mock('@/features/auth', ...)`.

### Task 7: Types, API, query keys, hooks and the money-input helper

**Files:**
- Create: `frontend/src/features/finance/types.ts`, `api/financeApi.ts`, `api/financeKeys.ts`, `api/hooks.ts`
- Modify: `frontend/src/shared/lib/money.ts`, `frontend/src/shared/lib/money.test.ts`

**Interfaces:**
- Produces (shared): `formatMinorForInput(minor: number, currency: string): string` (integer minor units to the string a person would type, using only integer arithmetic: `1234` USD gives `12.34`, `500` JPY gives `500`, `1234` BHD gives `1.234`).
- Produces (types): `TransactionKind`, `Category`, `Transaction`, `TransactionPage`, `TransactionFilters { from?; to?; kind?; categoryId? }`, `TransactionInput { kind; amountMinor; categoryId; date; note }`, `MonthSummary`, `CategorySpend`, `SpendingByCategory`, `MonthlyItem`, `MonthlyTotals`, `BalanceTrend`, `type RangeMonths = 6 | 12`.
- Produces (API): `listCategories(kind?)`, `createCategory(input)`, `renameCategory(id, name)`, `deleteCategory(id)`, `listTransactions(params)`, `listAllTransactionsInRange(from, to, maxPages?)`, `createTransaction(input)`, `updateTransaction(id, input)`, `deleteTransaction(id)`, `bulkCreateTransactions(rows)`, `fetchSummary(month)`, `fetchSpendingByCategory(month)`, `fetchMonthlyTotals(months)`, `fetchBalanceTrend(months)`.
- Produces (hooks): `useCategories()`, `useTransactions(params)`, `useCreateTransaction()`, `useUpdateTransaction()`, `useDeleteTransaction()`, `useBulkCreateTransactions()`, `useCreateCategory()`, `useRenameCategory()`, `useDeleteCategory()`, `useMonthSummary(month)`, `useSpendingByCategory(month)`, `useMonthlyTotals(months)`, `useBalanceTrend(months)`.

- [ ] **Step 0: Create the branch** (skip if already on `feature/finance-charts`)

```bash
git switch main && git switch -c feature/finance-charts
```

- [ ] **Step 1: Add the money-input helper with its test**

Append to `frontend/src/shared/lib/money.test.ts`:

```ts
import { formatMinorForInput } from './money'

describe('formatMinorForInput', () => {
  it.each([
    [1234, 'USD', '12.34'],
    [5, 'USD', '0.05'],
    [0, 'USD', '0.00'],
    [100000, 'USD', '1000.00'],
    [500, 'JPY', '500'],
    [1234, 'BHD', '1.234'],
    [7, 'BHD', '0.007'],
  ])('shows %i minor units of %s as %s', (minor, currency, expected) => {
    expect(formatMinorForInput(minor, currency)).toBe(expected)
  })

  it('round-trips with toMinorUnits for every supported exponent', () => {
    for (const [minor, currency] of [[1, 'USD'], [999999999, 'USD'], [42, 'JPY'], [1001, 'BHD']] as const) {
      expect(toMinorUnits(formatMinorForInput(minor, currency), currency)).toBe(minor)
    }
  })
})
```

(Merge the new `import { formatMinorForInput } from './money'` into the existing import at the top of the file rather than adding a second import line.)

Run: `npx vitest run src/shared/lib/money.test.ts` → FAIL. Append to `frontend/src/shared/lib/money.ts`:

```ts
/** What a person would type for this amount: integer arithmetic only, no floats. */
export function formatMinorForInput(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency)
  if (digits === 0) return String(minor)
  const padded = String(minor).padStart(digits + 1, '0')
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
```

Run → PASS.

- [ ] **Step 2: Write types, API and keys**

`frontend/src/features/finance/types.ts`:

```ts
export type TransactionKind = 'income' | 'expense'

export type RangeMonths = 6 | 12

export interface Category {
  id: string
  name: string
  kind: TransactionKind
}

export interface Transaction {
  id: string
  kind: TransactionKind
  amountMinor: number
  currency: string
  categoryId: string
  /** YYYY-MM-DD */
  date: string
  note: string
}

export interface TransactionPage {
  items: Transaction[]
  page: number
  limit: number
  total: number
}

export interface TransactionFilters {
  from?: string
  to?: string
  kind?: TransactionKind
  categoryId?: string
}

export interface TransactionInput {
  kind: TransactionKind
  amountMinor: number
  categoryId: string
  date: string
  note: string
}

export interface MonthSummary {
  month: string
  currency: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export interface CategorySpend {
  categoryId: string
  name: string
  totalMinor: number
}

export interface SpendingByCategory {
  month: string
  currency: string
  items: CategorySpend[]
}

export interface MonthlyItem {
  month: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

export interface MonthlyTotals {
  currency: string
  items: MonthlyItem[]
}

export interface BalanceTrend {
  currency: string
  openingMinor: number
  items: { month: string; balanceMinor: number }[]
}
```

`frontend/src/features/finance/api/financeApi.ts`:

```ts
import { httpClient } from '@/shared/api/httpClient'
import type {
  BalanceTrend,
  Category,
  MonthlyTotals,
  MonthSummary,
  RangeMonths,
  SpendingByCategory,
  Transaction,
  TransactionFilters,
  TransactionInput,
  TransactionKind,
  TransactionPage,
} from '../types'

export async function listCategories(kind?: TransactionKind): Promise<Category[]> {
  const { data } = await httpClient.get<{ items: Category[] }>('/categories', { params: { kind } })
  return data.items
}

export async function createCategory(input: { name: string; kind: TransactionKind }): Promise<Category> {
  const { data } = await httpClient.post<Category>('/categories', input)
  return data
}

export async function renameCategory(id: string, name: string): Promise<Category> {
  const { data } = await httpClient.patch<Category>(`/categories/${id}`, { name })
  return data
}

export async function deleteCategory(id: string): Promise<void> {
  await httpClient.delete(`/categories/${id}`)
}

export interface ListTransactionsParams extends TransactionFilters {
  page?: number
  limit?: number
}

export async function listTransactions(params: ListTransactionsParams): Promise<TransactionPage> {
  const { data } = await httpClient.get<TransactionPage>('/transactions', { params })
  return data
}

/** Every transaction in a date range, up to `maxPages` pages of 200. Used to spot duplicates. */
export async function listAllTransactionsInRange(
  from: string,
  to: string,
  maxPages = 5,
): Promise<Transaction[]> {
  const found: Transaction[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await listTransactions({ from, to, page, limit: 200 })
    found.push(...result.items)
    if (page * result.limit >= result.total) break
  }
  return found
}

export async function createTransaction(input: TransactionInput): Promise<Transaction> {
  const { data } = await httpClient.post<Transaction>('/transactions', input)
  return data
}

export async function updateTransaction(
  id: string,
  input: Partial<TransactionInput>,
): Promise<Transaction> {
  const { data } = await httpClient.patch<Transaction>(`/transactions/${id}`, input)
  return data
}

export async function deleteTransaction(id: string): Promise<void> {
  await httpClient.delete(`/transactions/${id}`)
}

export async function bulkCreateTransactions(rows: TransactionInput[]): Promise<{ created: number }> {
  const { data } = await httpClient.post<{ created: number }>('/transactions/bulk', { rows })
  return data
}

export async function fetchSummary(month: string): Promise<MonthSummary> {
  const { data } = await httpClient.get<MonthSummary>('/finance/summary', { params: { month } })
  return data
}

export async function fetchSpendingByCategory(month: string): Promise<SpendingByCategory> {
  const { data } = await httpClient.get<SpendingByCategory>('/finance/by-category', {
    params: { month },
  })
  return data
}

export async function fetchMonthlyTotals(months: RangeMonths): Promise<MonthlyTotals> {
  const { data } = await httpClient.get<MonthlyTotals>('/finance/monthly', { params: { months } })
  return data
}

export async function fetchBalanceTrend(months: RangeMonths): Promise<BalanceTrend> {
  const { data } = await httpClient.get<BalanceTrend>('/finance/trend', { params: { months } })
  return data
}
```

`frontend/src/features/finance/api/financeKeys.ts`:

```ts
import type { RangeMonths } from '../types'
import type { ListTransactionsParams } from './financeApi'

export const financeKeys = {
  all: ['finance'] as const,
  categories: ['finance', 'categories'] as const,
  transactions: (params: ListTransactionsParams) => ['finance', 'transactions', params] as const,
  summary: (month: string) => ['finance', 'summary', month] as const,
  byCategory: (month: string) => ['finance', 'by-category', month] as const,
  monthly: (months: RangeMonths) => ['finance', 'monthly', months] as const,
  trend: (months: RangeMonths) => ['finance', 'trend', months] as const,
  existingInRange: (from: string, to: string) => ['finance', 'existing', from, to] as const,
}
```

- [ ] **Step 3: Implement the hooks**

`frontend/src/features/finance/api/hooks.ts`:

```ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RangeMonths } from '../types'
import {
  bulkCreateTransactions,
  createCategory,
  createTransaction,
  deleteCategory,
  deleteTransaction,
  fetchBalanceTrend,
  fetchMonthlyTotals,
  fetchSpendingByCategory,
  fetchSummary,
  listCategories,
  listTransactions,
  renameCategory,
  updateTransaction,
  type ListTransactionsParams,
} from './financeApi'
import { financeKeys } from './financeKeys'

export function useCategories() {
  return useQuery({ queryKey: financeKeys.categories, queryFn: () => listCategories() })
}

export function useTransactions(params: ListTransactionsParams) {
  return useQuery({
    queryKey: financeKeys.transactions(params),
    queryFn: () => listTransactions(params),
    placeholderData: keepPreviousData,
  })
}

export function useMonthSummary(month: string) {
  return useQuery({ queryKey: financeKeys.summary(month), queryFn: () => fetchSummary(month) })
}

export function useSpendingByCategory(month: string) {
  return useQuery({
    queryKey: financeKeys.byCategory(month),
    queryFn: () => fetchSpendingByCategory(month),
  })
}

export function useMonthlyTotals(months: RangeMonths) {
  return useQuery({ queryKey: financeKeys.monthly(months), queryFn: () => fetchMonthlyTotals(months) })
}

export function useBalanceTrend(months: RangeMonths) {
  return useQuery({ queryKey: financeKeys.trend(months), queryFn: () => fetchBalanceTrend(months) })
}

/** Anything that changes money or category names changes every list, chart and total. */
function useInvalidateFinance() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: financeKeys.all })
}

export function useCreateTransaction() {
  return useMutation({ mutationFn: createTransaction, onSuccess: useInvalidateFinance() })
}

export function useUpdateTransaction() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTransaction>[1] }) =>
      updateTransaction(id, input),
    onSuccess: useInvalidateFinance(),
  })
}

export function useDeleteTransaction() {
  return useMutation({ mutationFn: deleteTransaction, onSuccess: useInvalidateFinance() })
}

export function useBulkCreateTransactions() {
  return useMutation({ mutationFn: bulkCreateTransactions, onSuccess: useInvalidateFinance() })
}

export function useCreateCategory() {
  return useMutation({ mutationFn: createCategory, onSuccess: useInvalidateFinance() })
}

export function useRenameCategory() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameCategory(id, name),
    onSuccess: useInvalidateFinance(),
  })
}

export function useDeleteCategory() {
  return useMutation({ mutationFn: deleteCategory, onSuccess: useInvalidateFinance() })
}
```

`useInvalidateFinance()` is a hook that returns a function and is called during render inside each mutation hook, which is what the rules of hooks require. The `onSuccess` it returns is stable enough for TanStack Query.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(finance): add types, API, query keys, hooks and money-input helper" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: CSV parser and import mapping (pure functions)

**Files:**
- Create: `frontend/src/features/finance/csv.ts`, `csv.test.ts`, `csvImport.ts`, `csvImport.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]` (RFC 4180 style, auto-detects `,` `;` or tab, drops a BOM and blank lines); `type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'`, `DATE_FORMATS`, `parseDate(value, format): string | null`, `parseSignedAmount(value, currency): { minor: number; negative: boolean } | null`, `ImportMapping`, `RowError { row: number; message: string }`, `mapRows(rows, mapping, hasHeader): { valid: TransactionInput[]; errors: RowError[] }`, `guessColumns(header: string[]): { dateColumn: number; amountColumn: number; noteColumn: number | null }`, `duplicateKey(row)`, `countExistingDuplicates(rows, existing): number`, `chunk<T>(items: T[], size: number): T[][]`.

- [ ] **Step 1: Write the failing CSV parser tests**

`frontend/src/features/finance/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('does not need a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    const text = 'name,note\n"Smith, Jo","said ""hi"""\n"two\nlines",x\n'

    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Smith, Jo', 'said "hi"'],
      ['two\nlines', 'x'],
    ])
  })

  it('handles CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('drops a byte-order mark', () => {
    expect(parseCsv('﻿date,amount\n1,2')[0]).toEqual(['date', 'amount'])
  })

  it('skips blank lines and lines with only empty cells', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n   ,  \n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,c\n1,2,\n')).toEqual([
      ['a', '', 'c'],
      ['1', '2', ''],
    ])
  })

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,5', '3'],
    ])
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('does not mistake commas inside quotes for the delimiter', () => {
    expect(parseCsv('"a,b,c";d\n1;2')).toEqual([
      ['a,b,c', 'd'],
      ['1', '2'],
    ])
  })

  it('keeps a quote in the middle of an unquoted field literally', () => {
    expect(parseCsv('5" pipe,ok\n')).toEqual([['5" pipe', 'ok']])
  })

  it('returns no rows for empty input and one row for a header-only file', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
    expect(parseCsv('date,amount,note\n')).toEqual([['date', 'amount', 'note']])
  })

  it('does not hang or throw on an unterminated quote', () => {
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']])
  })
})
```

Run: `npx vitest run src/features/finance/csv.test.ts` → FAIL.

- [ ] **Step 2: Implement the parser**

`frontend/src/features/finance/csv.ts`:

```ts
const DELIMITERS = [',', ';', '\t'] as const

/** Picks the delimiter that occurs most often in the first line, ignoring quoted text. */
function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]))
  let inQuotes = false
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\n' || char === '\r')) break
    else if (!inQuotes && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1)
  }
  let best: string = ','
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter
  }
  return best
}

/**
 * Parses CSV text into rows of cells. Handles quoted fields (commas, line breaks and doubled
 * quotes inside them), CRLF, a leading byte-order mark, and comma, semicolon or tab delimiters.
 * Rows whose cells are all blank are dropped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '')
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)

    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(index + 1) === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(index + 1) === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}
```

Run → PASS.

- [ ] **Step 3: Write the failing mapping tests**

`frontend/src/features/finance/csvImport.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  chunk,
  countExistingDuplicates,
  duplicateKey,
  guessColumns,
  mapRows,
  parseDate,
  parseSignedAmount,
  type ImportMapping,
} from './csvImport'
import type { Transaction } from './types'

describe('parseDate', () => {
  it.each([
    ['2026-09-05', 'YYYY-MM-DD', '2026-09-05'],
    ['2026-9-5', 'YYYY-MM-DD', '2026-09-05'],
    ['05/09/2026', 'DD/MM/YYYY', '2026-09-05'],
    ['5.9.2026', 'DD/MM/YYYY', '2026-09-05'],
    ['09/05/2026', 'MM/DD/YYYY', '2026-09-05'],
    [' 2026-12-31 ', 'YYYY-MM-DD', '2026-12-31'],
    ['29/02/2028', 'DD/MM/YYYY', '2028-02-29'],
  ] as const)('reads %j as %s', (value, format, expected) => {
    expect(parseDate(value, format)).toBe(expected)
  })

  it.each([
    ['2026-02-30', 'YYYY-MM-DD'],
    ['29/02/2027', 'DD/MM/YYYY'],
    ['31/04/2026', 'DD/MM/YYYY'],
    ['13/13/2026', 'MM/DD/YYYY'],
    ['05/09/26', 'DD/MM/YYYY'],
    ['', 'YYYY-MM-DD'],
    ['yesterday', 'YYYY-MM-DD'],
    ['2026-09-05', 'DD/MM/YYYY'],
  ] as const)('rejects %j as %s', (value, format) => {
    expect(parseDate(value, format)).toBeNull()
  })
})

describe('parseSignedAmount', () => {
  it.each([
    ['12.34', 'USD', { minor: 1234, negative: false }],
    ['-12.34', 'USD', { minor: 1234, negative: true }],
    ['+5', 'USD', { minor: 500, negative: false }],
    ['(45.10)', 'USD', { minor: 4510, negative: true }],
    ['12.34-', 'USD', { minor: 1234, negative: true }],
    ['−7.00', 'USD', { minor: 700, negative: true }],
    ['$1,234.50', 'USD', { minor: 123450, negative: false }],
    ['-€ 1.234,50', 'EUR', { minor: 123450, negative: true }],
    ['12,50', 'EUR', { minor: 1250, negative: false }],
    ['-500', 'JPY', { minor: 500, negative: true }],
    ['1.234', 'BHD', { minor: 1234, negative: false }],
    ['0.00', 'USD', { minor: 0, negative: false }],
  ] as const)('reads %j in %s', (value, currency, expected) => {
    expect(parseSignedAmount(value, currency)).toEqual(expected)
  })

  it.each([['', 'USD'], ['abc', 'USD'], ['1.234', 'USD'], ['5.5', 'JPY'], ['12.3.4', 'USD']] as const)(
    'rejects %j in %s',
    (value, currency) => {
      expect(parseSignedAmount(value, currency)).toBeNull()
    },
  )
})

const mapping: ImportMapping = {
  dateColumn: 0,
  amountColumn: 1,
  noteColumn: 2,
  dateFormat: 'YYYY-MM-DD',
  negativeIsExpense: true,
  expenseCategoryId: 'cat-expense',
  incomeCategoryId: 'cat-income',
  currency: 'USD',
}

describe('mapRows', () => {
  const rows = [
    ['Date', 'Amount', 'Description'],
    ['2026-09-01', '-12.50', 'Coffee'],
    ['2026-09-02', '3000.00', 'Salary'],
  ]

  it('skips the header and turns rows into transactions with the chosen categories', () => {
    const { valid, errors } = mapRows(rows, mapping, true)

    expect(errors).toEqual([])
    expect(valid).toEqual([
      { kind: 'expense', amountMinor: 1250, categoryId: 'cat-expense', date: '2026-09-01', note: 'Coffee' },
      { kind: 'income', amountMinor: 300000, categoryId: 'cat-income', date: '2026-09-02', note: 'Salary' },
    ])
  })

  it('treats the first row as data when there is no header', () => {
    const { valid, errors } = mapRows(rows.slice(1), mapping, false)

    expect(valid).toHaveLength(2)
    expect(errors).toEqual([])
  })

  it('flips the sign convention for card exports where a positive amount is spending', () => {
    const { valid } = mapRows(rows, { ...mapping, negativeIsExpense: false }, true)

    expect(valid.map((row) => row.kind)).toEqual(['income', 'expense'])
  })

  it('reports each bad row by number and keeps the good ones', () => {
    const bad = [
      ['Date', 'Amount', 'Description'],
      ['2026-09-01', '-12.50', 'ok'],
      ['not a date', '-5', 'bad date'],
      ['2026-09-03', 'lots', 'bad amount'],
      ['2026-09-04', '0', 'zero'],
      ['2026-09-05', '-1.00', 'fine'],
    ]

    const { valid, errors } = mapRows(bad, mapping, true)

    expect(valid.map((row) => row.note)).toEqual(['ok', 'fine'])
    expect(errors).toEqual([
      { row: 3, message: 'Could not read the date "not a date"' },
      { row: 4, message: 'Could not read the amount "lots"' },
      { row: 5, message: 'The amount must be greater than zero' },
    ])
  })

  it('handles a short row, a missing note column and long notes', () => {
    const { valid, errors } = mapRows(
      [['2026-09-01'], ['2026-09-02', '-1', 'x'.repeat(300)]],
      { ...mapping, noteColumn: null },
      false,
    )

    expect(errors).toEqual([{ row: 1, message: 'Could not read the amount ""' }])
    expect(valid[0]?.note).toBe('')
  })

  it('truncates a note to 200 characters', () => {
    const { valid } = mapRows([['2026-09-02', '-1', 'x'.repeat(300)]], mapping, false)

    expect(valid[0]?.note).toHaveLength(200)
  })

  it('returns nothing for a header-only file', () => {
    expect(mapRows([['Date', 'Amount']], mapping, true)).toEqual({ valid: [], errors: [] })
  })

  it('uses whole minor units for currencies without decimals', () => {
    const { valid } = mapRows([['2026-09-01', '-500', 'ramen']], { ...mapping, currency: 'JPY' }, false)

    expect(valid[0]?.amountMinor).toBe(500)
  })
})

describe('guessColumns', () => {
  it('finds the date, amount and description columns by their header names', () => {
    expect(guessColumns(['Posted Date', 'Payee', 'Amount (USD)', 'Balance'])).toEqual({
      dateColumn: 0,
      amountColumn: 2,
      noteColumn: 1,
    })
  })

  it('falls back to the first columns when the names give no clue', () => {
    expect(guessColumns(['A', 'B', 'C'])).toEqual({ dateColumn: 0, amountColumn: 1, noteColumn: 2 })
    expect(guessColumns(['A', 'B'])).toEqual({ dateColumn: 0, amountColumn: 1, noteColumn: null })
  })
})

describe('duplicates', () => {
  const coffee: Transaction = {
    id: '1',
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    categoryId: 'c',
    date: '2026-09-01',
    note: 'Coffee',
  }
  const existing = [coffee]

  it('builds a key from date, kind, amount and a case-insensitive note', () => {
    expect(duplicateKey({ date: '2026-09-01', kind: 'expense', amountMinor: 1250, note: ' COFFEE ' })).toBe(
      duplicateKey(coffee),
    )
  })

  it('counts imported rows that match an existing transaction', () => {
    const rows = [
      { kind: 'expense' as const, amountMinor: 1250, categoryId: 'x', date: '2026-09-01', note: 'coffee' },
      { kind: 'expense' as const, amountMinor: 1251, categoryId: 'x', date: '2026-09-01', note: 'coffee' },
      { kind: 'income' as const, amountMinor: 1250, categoryId: 'x', date: '2026-09-01', note: 'coffee' },
    ]

    expect(countExistingDuplicates(rows, existing)).toBe(1)
  })
})

describe('chunk', () => {
  it('splits into batches and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 500)).toEqual([])
    expect(chunk([1], 500)).toEqual([[1]])
  })
})
```

Run: `npx vitest run src/features/finance/csvImport.test.ts` → FAIL.

- [ ] **Step 4: Implement the mapping**

`frontend/src/features/finance/csvImport.ts`:

```ts
import { toMinorUnits } from '@/shared/lib/money'
import type { Transaction, TransactionInput } from './types'

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
export const DATE_FORMATS: DateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']

export interface ImportMapping {
  dateColumn: number
  amountColumn: number
  noteColumn: number | null
  dateFormat: DateFormat
  /** true: negative amounts are spending (bank statements). false: positive amounts are spending (card exports). */
  negativeIsExpense: boolean
  expenseCategoryId: string
  incomeCategoryId: string
  currency: string
}

export interface RowError {
  /** Counted over non-empty rows, starting at 1, header included. */
  row: number
  message: string
}

const PATTERNS: Record<DateFormat, RegExp> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  'DD/MM/YYYY': /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  'MM/DD/YYYY': /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function parseDate(value: string, format: DateFormat): string | null {
  const match = PATTERNS[format].exec(value.trim())
  if (!match) return null
  const [first = 0, second = 0, third = 0] = match.slice(1).map(Number)

  let [year, month, day] = [first, second, third]
  if (format === 'DD/MM/YYYY') [year, month, day] = [third, second, first]
  if (format === 'MM/DD/YYYY') [year, month, day] = [third, first, second]

  // Date.UTC rolls an impossible date (30 February) over, so compare the parts to catch it.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The size and sign of an amount as written in a bank export: "-12.50", "(12.50)", "12.50-",
 * "$1,234.50", "-€ 1.234,50". Never rounds: a value with too many decimals is null.
 */
export function parseSignedAmount(
  value: string,
  currency: string,
): { minor: number; negative: boolean } | null {
  let text = value.trim()
  let negative = false

  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }
  if (text.endsWith('-')) {
    negative = true
    text = text.slice(0, -1)
  }

  const minor = toMinorUnits(text.replace(/[^\d.,\s]/g, '').trim(), currency)
  return minor === null ? null : { minor, negative }
}

export interface MappedRows {
  valid: TransactionInput[]
  errors: RowError[]
}

export function mapRows(rows: string[][], mapping: ImportMapping, hasHeader: boolean): MappedRows {
  const valid: TransactionInput[] = []
  const errors: RowError[] = []

  for (const [index, cells] of rows.entries()) {
    if (hasHeader && index === 0) continue
    const row = index + 1

    const dateText = cells[mapping.dateColumn] ?? ''
    const date = parseDate(dateText, mapping.dateFormat)
    if (!date) {
      errors.push({ row, message: `Could not read the date "${dateText.trim()}"` })
      continue
    }

    const amountText = cells[mapping.amountColumn] ?? ''
    const amount = parseSignedAmount(amountText, mapping.currency)
    if (!amount) {
      errors.push({ row, message: `Could not read the amount "${amountText.trim()}"` })
      continue
    }
    if (amount.minor === 0) {
      errors.push({ row, message: 'The amount must be greater than zero' })
      continue
    }

    const kind = amount.negative === mapping.negativeIsExpense ? 'expense' : 'income'
    const noteText = mapping.noteColumn === null ? '' : (cells[mapping.noteColumn] ?? '')
    valid.push({
      kind,
      amountMinor: amount.minor,
      categoryId: kind === 'expense' ? mapping.expenseCategoryId : mapping.incomeCategoryId,
      date,
      note: noteText.trim().slice(0, 200),
    })
  }
  return { valid, errors }
}

/** Best guess at which columns hold the date, the amount and the description. */
export function guessColumns(header: string[]): {
  dateColumn: number
  amountColumn: number
  noteColumn: number | null
} {
  const find = (pattern: RegExp) => {
    const index = header.findIndex((name) => pattern.test(name))
    return index === -1 ? null : index
  }
  const dateColumn = find(/date|posted|time/i) ?? 0
  const amountColumn = find(/amount|value|sum|total|debit|credit/i) ?? (dateColumn === 0 ? 1 : 0)
  const noteColumn =
    find(/desc|memo|note|payee|narrative|detail|reference/i) ??
    [0, 1, 2].find((index) => index !== dateColumn && index !== amountColumn && index < header.length) ??
    null
  return { dateColumn, amountColumn, noteColumn }
}

/** Two transactions with the same key look like the same payment. */
export function duplicateKey(row: {
  date: string
  kind: string
  amountMinor: number
  note: string
}): string {
  return `${row.date}|${row.kind}|${row.amountMinor}|${row.note.trim().toLowerCase()}`
}

/** How many rows to import already exist. Only a warning: they are still imported if the user proceeds. */
export function countExistingDuplicates(rows: TransactionInput[], existing: Transaction[]): number {
  const known = new Set(existing.map(duplicateKey))
  return rows.filter((row) => known.has(duplicateKey(row))).length
}

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size) batches.push(items.slice(start, start + size))
  return batches
}
```

Run: `npx vitest run src/features/finance` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(finance): add CSV parser and import mapping with row-level errors" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Charts

**Files:**
- Create: `frontend/src/features/finance/chartSetup.ts`, `useChartColors.ts`, `components/ChartDataTable.tsx`, `components/SpendingByCategoryChart.tsx`, `components/SpendingByCategoryChart.test.tsx`, `components/IncomeExpenseChart.tsx`, `components/IncomeExpenseChart.test.tsx`, `components/NetTrendChart.tsx`, `components/NetTrendChart.test.tsx`, `frontend/src/features/finance/finance.css`

**Interfaces:**
- Consumes: `useSpendingByCategory`, `useMonthlyTotals`, `useBalanceTrend`, `minorToMajor`, `formatMinorUnits`, `formatMonth`, `useThemeStore`.
- Produces: `useChartColors(): ChartColors` (`{ text, muted, grid, surface, positive, danger, accent, series: string[] }`, read from the theme's CSS variables and recomputed when the theme changes); `ChartDataTable({ caption, columns, rows })` (a visually hidden table for screen readers); `SpendingByCategoryChart({ month })`, `IncomeExpenseChart({ months? = 6 })`, `NetTrendChart({ months? = 6 })`.

Chart.js draws on a canvas, which jsdom cannot do, so the tests replace `react-chartjs-2` with components that print the `data` they were given. The tests then check what the charts would show (labels and plotted values), with amounts converted from minor units for display only.

- [ ] **Step 1: Write the failing SpendingByCategoryChart test**

`frontend/src/features/finance/components/SpendingByCategoryChart.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { SpendingByCategoryChart } from './SpendingByCategoryChart'

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Doughnut: (props: { data: unknown }) => <pre data-testid="doughnut">{JSON.stringify(props.data)}</pre>,
}))

const plotted = () => JSON.parse(screen.getByTestId('doughnut').textContent ?? '{}')

beforeEach(() => {
  vi.resetAllMocks()
  document.documentElement.style.removeProperty('--chart-1')
})

describe('SpendingByCategoryChart', () => {
  it('shows a loading state, then the chart', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 7500 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
  })

  it('plots categories in major units and asks for the chosen month', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [
        { categoryId: 'a', name: 'Groceries', totalMinor: 7500 },
        { categoryId: 'b', name: 'Transport', totalMinor: 1205 },
      ],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(vi.mocked(financeApi.fetchSpendingByCategory).mock.calls[0]?.[0]).toBe('2026-09')
    expect(plotted().labels).toEqual(['Groceries', 'Transport'])
    expect(plotted().datasets[0].data).toEqual([75, 12.05])
  })

  it.each([
    ['JPY', 500, 500],
    ['BHD', 1234, 1.234],
  ])('plots %s amounts with the right number of decimals', async (currency, totalMinor, expected) => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency,
      items: [{ categoryId: 'a', name: 'Food', totalMinor }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(plotted().datasets[0].data).toEqual([expected])
  })

  it('gives screen readers the same numbers in a table, formatted as money', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 7500 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    const table = await screen.findByRole('table', { name: /spending by category/i })
    expect(within(table).getByRole('cell', { name: 'Groceries' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '$75.00' })).toBeInTheDocument()
  })

  it('takes segment colours from the current theme', async () => {
    document.documentElement.style.setProperty('--chart-1', '#123456')
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 100 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await screen.findByTestId('doughnut')

    expect(plotted().datasets[0].backgroundColor[0]).toBe('#123456')
  })

  it('invites the user to add an expense when there is no spending', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)

    expect(await screen.findByText('No spending this month')).toBeInTheDocument()
    expect(screen.queryByTestId('doughnut')).not.toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(financeApi.fetchSpendingByCategory).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      items: [{ categoryId: 'a', name: 'Groceries', totalMinor: 100 }],
    })

    renderWithProviders(<SpendingByCategoryChart month="2026-09" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the chart plumbing and the doughnut**

`frontend/src/features/finance/chartSetup.ts`:

```ts
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'

// Registering only what the three charts use keeps the bundle small.
Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
)
```

`frontend/src/features/finance/useChartColors.ts`:

```ts
import { useMemo } from 'react'
import { useThemeStore } from '@/shared/theme/themeStore'

export interface ChartColors {
  text: string
  muted: string
  grid: string
  surface: string
  positive: string
  danger: string
  accent: string
  series: string[]
}

function readColors(): ChartColors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    text: read('--text'),
    muted: read('--text-muted'),
    grid: read('--border'),
    surface: read('--surface'),
    positive: read('--positive'),
    danger: read('--danger'),
    accent: read('--accent'),
    series: [1, 2, 3, 4, 5, 6].map((index) => read(`--chart-${index}`)),
  }
}

/** Chart colours come from the CSS variables of the active theme, so charts follow theme changes. */
export function useChartColors(): ChartColors {
  const theme = useThemeStore((state) => state.theme)
  return useMemo(readColors, [theme])
}
```

`frontend/src/features/finance/components/ChartDataTable.tsx`:

```tsx
interface ChartDataTableProps {
  caption: string
  columns: string[]
  rows: string[][]
}

/** The chart's numbers as a real table, visually hidden, for screen readers. */
export function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, rowIndex) => (
          <tr key={rowIndex}>
            {cells.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

`frontend/src/features/finance/components/SpendingByCategoryChart.tsx`:

```tsx
import { Doughnut } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useSpendingByCategory } from '../api/hooks'
import '../chartSetup'
import { useChartColors } from '../useChartColors'
import '../finance.css'
import { ChartDataTable } from './ChartDataTable'

export function SpendingByCategoryChart({ month }: { month: string }) {
  const query = useSpendingByCategory(month)
  const colors = useChartColors()

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) return <ErrorState message="Could not load spending" onRetry={() => query.refetch()} />

  const { items, currency } = query.data
  if (items.length === 0) {
    return (
      <EmptyState title="No spending this month" description="Add an expense to see where your money goes." />
    )
  }

  const caption = `Spending by category, ${formatMonth(month)}`
  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Doughnut
          role="img"
          aria-label={caption}
          data={{
            labels: items.map((item) => item.name),
            datasets: [
              {
                // Display only: the stored amounts stay integers.
                data: items.map((item) => minorToMajor(item.totalMinor, currency)),
                backgroundColor: items.map((_, index) => colors.series[index % colors.series.length] ?? ''),
                borderColor: colors.surface,
                borderWidth: 2,
              },
            ],
          }}
          options={{
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: colors.text } } },
          }}
        />
      </div>
      <ChartDataTable
        caption={caption}
        columns={['Category', 'Amount']}
        rows={items.map((item) => [item.name, formatMinorUnits(item.totalMinor, currency)])}
      />
    </figure>
  )
}
```

Append to (or create) `frontend/src/features/finance/finance.css`:

```css
.chart {
  margin: 0;
}
.chart figcaption {
  margin-bottom: var(--space-2);
  color: var(--text-muted);
  font-size: 0.9rem;
}
.chart__canvas {
  position: relative;
  height: 280px;
}
```

Run: `npx vitest run src/features/finance/components/SpendingByCategoryChart.test.tsx` → PASS.

- [ ] **Step 3: Write and implement the bar and line charts**

`frontend/src/features/finance/components/IncomeExpenseChart.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { IncomeExpenseChart } from './IncomeExpenseChart'

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Bar: (props: { data: unknown }) => <pre data-testid="bar">{JSON.stringify(props.data)}</pre>,
}))

const plotted = () => JSON.parse(screen.getByTestId('bar').textContent ?? '{}')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('IncomeExpenseChart', () => {
  it('plots income and expenses per month, oldest first, and asks for the chosen range', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [
        { month: '2026-08', incomeMinor: 300000, expenseMinor: 4000, netMinor: 296000 },
        { month: '2026-09', incomeMinor: 0, expenseMinor: 1250, netMinor: -1250 },
      ],
    })

    renderWithProviders(<IncomeExpenseChart months={12} />)
    await screen.findByTestId('bar')

    expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls[0]?.[0]).toBe(12)
    expect(plotted().labels).toEqual(['August 2026', 'September 2026'])
    const [income, expenses] = plotted().datasets
    expect([income.label, income.data]).toEqual(['Income', [3000, 0]])
    expect([expenses.label, expenses.data]).toEqual(['Expenses', [40, 12.5]])
  })

  it('offers the table alternative with formatted amounts', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 300000, expenseMinor: 1250, netMinor: 298750 }],
    })

    renderWithProviders(<IncomeExpenseChart />)

    const table = await screen.findByRole('table', { name: /income and expenses/i })
    expect(within(table).getByRole('cell', { name: '$3,000.00' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '$12.50' })).toBeInTheDocument()
  })

  it('shows an empty state when every month is zero', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
      currency: 'USD',
      items: [{ month: '2026-09', incomeMinor: 0, expenseMinor: 0, netMinor: 0 }],
    })

    renderWithProviders(<IncomeExpenseChart />)

    expect(await screen.findByText('No income or expenses yet')).toBeInTheDocument()
  })

  it('shows an error state', async () => {
    vi.mocked(financeApi.fetchMonthlyTotals).mockRejectedValue(new Error('boom'))

    renderWithProviders(<IncomeExpenseChart />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
```

`frontend/src/features/finance/components/NetTrendChart.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { NetTrendChart } from './NetTrendChart'

vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Line: (props: { data: unknown }) => <pre data-testid="line">{JSON.stringify(props.data)}</pre>,
}))

const plotted = () => JSON.parse(screen.getByTestId('line').textContent ?? '{}')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('NetTrendChart', () => {
  it('plots the running balance in major units, including a negative balance', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 10000,
      items: [
        { month: '2026-08', balanceMinor: 306000 },
        { month: '2026-09', balanceMinor: -1250 },
      ],
    })

    renderWithProviders(<NetTrendChart months={6} />)
    await screen.findByTestId('line')

    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls[0]?.[0]).toBe(6)
    expect(plotted().labels).toEqual(['August 2026', 'September 2026'])
    expect(plotted().datasets[0].data).toEqual([3060, -12.5])
  })

  it('offers the table alternative with formatted balances', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 123456 }],
    })

    renderWithProviders(<NetTrendChart />)

    const table = await screen.findByRole('table', { name: /balance/i })
    expect(within(table).getByRole('cell', { name: '$1,234.56' })).toBeInTheDocument()
  })

  it('shows loading, empty and error states', async () => {
    vi.mocked(financeApi.fetchBalanceTrend).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderWithProviders(<NetTrendChart />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()

    vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
      currency: 'USD',
      openingMinor: 0,
      items: [{ month: '2026-09', balanceMinor: 0 }],
    })
    const second = renderWithProviders(<NetTrendChart />)
    expect(await screen.findByText('No balance to show yet')).toBeInTheDocument()
    second.unmount()

    vi.mocked(financeApi.fetchBalanceTrend).mockRejectedValue(new Error('boom'))
    renderWithProviders(<NetTrendChart />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
```

`frontend/src/features/finance/components/IncomeExpenseChart.tsx`:

```tsx
import { Bar } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useMonthlyTotals } from '../api/hooks'
import '../chartSetup'
import type { RangeMonths } from '../types'
import { useChartColors } from '../useChartColors'
import '../finance.css'
import { ChartDataTable } from './ChartDataTable'
import { axisMoney } from './axisMoney'

export function IncomeExpenseChart({ months = 6 }: { months?: RangeMonths }) {
  const query = useMonthlyTotals(months)
  const colors = useChartColors()

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) return <ErrorState message="Could not load totals" onRetry={() => query.refetch()} />

  const { items, currency } = query.data
  if (items.every((item) => item.incomeMinor === 0 && item.expenseMinor === 0)) {
    return (
      <EmptyState title="No income or expenses yet" description="Add a transaction to see monthly totals." />
    )
  }

  const caption = `Income and expenses, last ${months} months`
  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Bar
          role="img"
          aria-label={caption}
          data={{
            labels: items.map((item) => formatMonth(item.month)),
            datasets: [
              {
                label: 'Income',
                data: items.map((item) => minorToMajor(item.incomeMinor, currency)),
                backgroundColor: colors.positive,
              },
              {
                label: 'Expenses',
                data: items.map((item) => minorToMajor(item.expenseMinor, currency)),
                backgroundColor: colors.danger,
              },
            ],
          }}
          options={{
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: colors.text } } },
            scales: {
              x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
              y: {
                ticks: { color: colors.muted, callback: (value) => axisMoney(Number(value), currency) },
                grid: { color: colors.grid },
              },
            },
          }}
        />
      </div>
      <ChartDataTable
        caption={caption}
        columns={['Month', 'Income', 'Expenses']}
        rows={items.map((item) => [
          formatMonth(item.month),
          formatMinorUnits(item.incomeMinor, currency),
          formatMinorUnits(item.expenseMinor, currency),
        ])}
      />
    </figure>
  )
}
```

`frontend/src/features/finance/components/axisMoney.ts`:

```ts
/** A whole-number currency label for a chart axis. Display only. */
export function axisMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    notation: 'compact',
  }).format(value)
}
```

`frontend/src/features/finance/components/NetTrendChart.tsx`:

```tsx
import { Line } from 'react-chartjs-2'
import { formatMonth } from '@/shared/lib/dates'
import { formatMinorUnits, minorToMajor } from '@/shared/lib/money'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useBalanceTrend } from '../api/hooks'
import '../chartSetup'
import type { RangeMonths } from '../types'
import { useChartColors } from '../useChartColors'
import '../finance.css'
import { ChartDataTable } from './ChartDataTable'
import { axisMoney } from './axisMoney'

export function NetTrendChart({ months = 6 }: { months?: RangeMonths }) {
  const query = useBalanceTrend(months)
  const colors = useChartColors()

  if (query.isPending) return <LoadingState label="Loading chart…" />
  if (query.isError) return <ErrorState message="Could not load the balance" onRetry={() => query.refetch()} />

  const { items, currency, openingMinor } = query.data
  if (openingMinor === 0 && items.every((item) => item.balanceMinor === 0)) {
    return <EmptyState title="No balance to show yet" description="Add income and expenses to see your balance." />
  }

  const caption = `Balance, last ${months} months`
  return (
    <figure className="chart">
      <figcaption>{caption}</figcaption>
      <div className="chart__canvas">
        <Line
          role="img"
          aria-label={caption}
          data={{
            labels: items.map((item) => formatMonth(item.month)),
            datasets: [
              {
                label: 'Balance',
                data: items.map((item) => minorToMajor(item.balanceMinor, currency)),
                borderColor: colors.accent,
                backgroundColor: colors.accent,
                tension: 0.25,
              },
            ],
          }}
          options={{
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
              y: {
                ticks: { color: colors.muted, callback: (value) => axisMoney(Number(value), currency) },
                grid: { color: colors.grid },
              },
            },
          }}
        />
      </div>
      <ChartDataTable
        caption={caption}
        columns={['Month', 'Balance']}
        rows={items.map((item) => [formatMonth(item.month), formatMinorUnits(item.balanceMinor, currency)])}
      />
    </figure>
  )
}
```

Run: `npx vitest run src/features/finance/components` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(finance): add theme-aware spending, income/expense and balance charts" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Month picker, summary cards, transaction form, list and category manager

**Files:**
- Create under `frontend/src/features/finance/`: `transactionForm.ts`, `transactionForm.test.ts`, `components/MonthPicker.tsx`, `components/MonthPicker.test.tsx`, `components/SummaryCards.tsx`, `components/SummaryCards.test.tsx`, `components/TransactionFormModal.tsx`, `components/TransactionFormModal.test.tsx`, `components/TransactionList.tsx`, `components/TransactionList.test.tsx`, `components/CategoryManager.tsx`, `components/CategoryManager.test.tsx`
- Modify: `frontend/src/features/finance/finance.css` (append)

**Interfaces:**
- Produces: `makeTransactionFormSchema(currency)`, `type TransactionFormValues`, `toTransactionInput(values, currency): TransactionInput`, `toFormValues(currency, transaction?, today?): TransactionFormValues`; `MonthPicker({ value, onChange })`; `SummaryCards({ month })`; `TransactionFormModal({ mode, onClose })` with `mode: { kind: 'create' } | { kind: 'edit'; transaction: Transaction }` (exported type `TransactionFormMode`); `TransactionList({ onEdit })`; `CategoryManager({ onClose })`.

- [ ] **Step 1: Write the failing form-logic tests**

`frontend/src/features/finance/transactionForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { makeTransactionFormSchema, toFormValues, toTransactionInput } from './transactionForm'
import type { Transaction } from './types'

const valid = {
  kind: 'expense',
  amount: '12.50',
  categoryId: 'cat1',
  date: '2026-09-15',
  note: 'Lunch',
} as const

describe('makeTransactionFormSchema', () => {
  const usd = makeTransactionFormSchema('USD')

  it('accepts a valid expense', () => {
    expect(usd.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['an empty amount', { amount: '' }, 'Enter an amount'],
    ['text for an amount', { amount: 'abc' }, 'Enter a valid amount in USD'],
    ['too many decimals', { amount: '1.234' }, 'Enter a valid amount in USD'],
    ['a zero amount', { amount: '0' }, 'Amount must be greater than zero'],
    ['a negative amount', { amount: '-5' }, 'Enter a valid amount in USD'],
    ['a huge amount', { amount: '99999999999999' }, 'Amount is too large'],
    ['no category', { categoryId: '' }, 'Choose a category'],
    ['a bad date', { date: '' }, 'Choose a date'],
    ['a long note', { note: 'x'.repeat(201) }, 'Use at most 200 characters'],
  ])('rejects %s', (_name, override, message) => {
    const result = usd.safeParse({ ...valid, ...override })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })

  it('uses the currency to decide how many decimals are allowed', () => {
    expect(makeTransactionFormSchema('JPY').safeParse({ ...valid, amount: '500' }).success).toBe(true)
    expect(makeTransactionFormSchema('JPY').safeParse({ ...valid, amount: '5.5' }).success).toBe(false)
    expect(makeTransactionFormSchema('BHD').safeParse({ ...valid, amount: '1.234' }).success).toBe(true)
  })
})

describe('toTransactionInput', () => {
  it('converts the typed amount to integer minor units', () => {
    expect(toTransactionInput(valid, 'USD')).toEqual({
      kind: 'expense',
      amountMinor: 1250,
      categoryId: 'cat1',
      date: '2026-09-15',
      note: 'Lunch',
    })
    expect(toTransactionInput({ ...valid, amount: '500' }, 'JPY').amountMinor).toBe(500)
    expect(toTransactionInput({ ...valid, amount: '1.234' }, 'BHD').amountMinor).toBe(1234)
  })

  it('trims the note', () => {
    expect(toTransactionInput({ ...valid, note: '  hi  ' }, 'USD').note).toBe('hi')
  })
})

describe('toFormValues', () => {
  it('starts a new expense dated today with no category', () => {
    expect(toFormValues('USD', undefined, '2026-09-24')).toEqual({
      kind: 'expense',
      amount: '',
      categoryId: '',
      date: '2026-09-24',
      note: '',
    })
  })

  it('fills the form from an existing transaction in the currency\'s own format', () => {
    const transaction: Transaction = {
      id: '1',
      kind: 'income',
      amountMinor: 123456,
      currency: 'USD',
      categoryId: 'cat9',
      date: '2026-09-01',
      note: 'Pay',
    }

    expect(toFormValues('USD', transaction)).toEqual({
      kind: 'income',
      amount: '1234.56',
      categoryId: 'cat9',
      date: '2026-09-01',
      note: 'Pay',
    })
  })
})
```

Run → FAIL. Implement `frontend/src/features/finance/transactionForm.ts`:

```ts
import { z } from 'zod'
import { formatMinorForInput, toMinorUnits } from '@/shared/lib/money'
import { todayIso } from '@/shared/lib/dates'
import type { Transaction, TransactionInput } from './types'

const MAX_MINOR = 1_000_000_000_000

export function makeTransactionFormSchema(currency: string) {
  return z.object({
    kind: z.enum(['expense', 'income']),
    amount: z
      .string()
      .trim()
      .min(1, 'Enter an amount')
      .superRefine((value, context) => {
        const minor = toMinorUnits(value, currency)
        if (minor === null) {
          context.addIssue({ code: 'custom', message: `Enter a valid amount in ${currency}` })
        } else if (minor === 0) {
          context.addIssue({ code: 'custom', message: 'Amount must be greater than zero' })
        } else if (minor > MAX_MINOR) {
          context.addIssue({ code: 'custom', message: 'Amount is too large' })
        }
      }),
    categoryId: z.string().min(1, 'Choose a category'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    note: z.string().max(200, 'Use at most 200 characters'),
  })
}

export type TransactionFormValues = z.infer<ReturnType<typeof makeTransactionFormSchema>>

export function toTransactionInput(values: TransactionFormValues, currency: string): TransactionInput {
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
    amount: formatMinorForInput(transaction.amountMinor, currency),
    categoryId: transaction.categoryId,
    date: transaction.date,
    note: transaction.note,
  }
}
```

Run → PASS. (`toTransactionInput` returns `?? 0` only for the impossible case where the schema has not validated; the form always validates first.)

- [ ] **Step 2: Month picker**

`frontend/src/features/finance/components/MonthPicker.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MonthPicker } from './MonthPicker'

describe('MonthPicker', () => {
  it('shows the current month', () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />)

    expect(screen.getByLabelText('Choose month')).toHaveValue('2026-09')
  })

  it('steps to the previous and next month, across a year boundary', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<MonthPicker value="2026-01" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onChange).toHaveBeenLastCalledWith('2025-12')

    rerender(<MonthPicker value="2026-12" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onChange).toHaveBeenLastCalledWith('2027-01')
  })

  it('reports a month typed or picked, and ignores clearing the field', () => {
    const onChange = vi.fn()
    render(<MonthPicker value="2026-09" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '2026-05' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-05')

    onChange.mockClear()
    fireEvent.change(screen.getByLabelText('Choose month'), { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

`frontend/src/features/finance/components/MonthPicker.tsx`:

```tsx
import { shiftMonthIso } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import '../finance.css'

interface MonthPickerProps {
  value: string
  onChange: (month: string) => void
}

export function MonthPicker({ value, onChange }: MonthPickerProps) {
  return (
    <div className="month-picker" role="group" aria-label="Month">
      <Button variant="ghost" aria-label="Previous month" onClick={() => onChange(shiftMonthIso(value, -1))}>
        ‹
      </Button>
      <input
        type="month"
        aria-label="Choose month"
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
      />
      <Button variant="ghost" aria-label="Next month" onClick={() => onChange(shiftMonthIso(value, 1))}>
        ›
      </Button>
    </div>
  )
}
```

Run its test → PASS.

- [ ] **Step 3: Summary cards**

`frontend/src/features/finance/components/SummaryCards.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { SummaryCards } from './SummaryCards'

vi.mock('../api/financeApi')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('SummaryCards', () => {
  it('shows income, expenses and net for the month, formatted as money', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect(await screen.findByText('$3,000.00')).toBeInTheDocument()
    expect(screen.getByText('$87.00')).toBeInTheDocument()
    expect(screen.getByText('$2,913.00')).toBeInTheDocument()
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe('2026-09')
  })

  it('marks a negative net so it is not only a colour', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      incomeMinor: 0,
      expenseMinor: 999,
      netMinor: -999,
    })

    renderWithProviders(<SummaryCards month="2026-09" />)

    const net = await screen.findByText('-$9.99')
    expect(net).toHaveClass('is-negative')
  })

  it('formats currencies without decimals correctly', async () => {
    vi.mocked(financeApi.fetchSummary).mockResolvedValue({
      month: '2026-09',
      currency: 'JPY',
      incomeMinor: 500,
      expenseMinor: 0,
      netMinor: 500,
    })

    renderWithProviders(<SummaryCards month="2026-09" />)

    expect((await screen.findAllByText('¥500')).length).toBeGreaterThan(0)
  })

  it('shows loading, then an error with a retry', async () => {
    vi.mocked(financeApi.fetchSummary).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.fetchSummary).mockResolvedValue({
      month: '2026-09',
      currency: 'USD',
      incomeMinor: 100,
      expenseMinor: 0,
      netMinor: 100,
    })

    renderWithProviders(<SummaryCards month="2026-09" />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect((await screen.findAllByText('$1.00')).length).toBeGreaterThan(0)
  })
})
```

`frontend/src/features/finance/components/SummaryCards.tsx`:

```tsx
import { formatMinorUnits } from '@/shared/lib/money'
import { Card } from '@/shared/ui/Card'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useMonthSummary } from '../api/hooks'
import '../finance.css'

export function SummaryCards({ month }: { month: string }) {
  const query = useMonthSummary(month)

  if (query.isPending) return <LoadingState label="Loading totals…" />
  if (query.isError) return <ErrorState message="Could not load totals" onRetry={() => query.refetch()} />

  const { currency, incomeMinor, expenseMinor, netMinor } = query.data
  return (
    <div className="summary-cards">
      <Card title="Income">
        <p className="summary-cards__value is-positive">{formatMinorUnits(incomeMinor, currency)}</p>
      </Card>
      <Card title="Expenses">
        <p className="summary-cards__value">{formatMinorUnits(expenseMinor, currency)}</p>
      </Card>
      <Card title="Net">
        <p className={`summary-cards__value${netMinor < 0 ? ' is-negative' : ' is-positive'}`}>
          {formatMinorUnits(netMinor, currency)}
        </p>
      </Card>
    </div>
  )
}
```

Run its test → PASS.

- [ ] **Step 4: Transaction form modal**

`frontend/src/features/finance/components/TransactionFormModal.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category, Transaction } from '../types'
import { TransactionFormModal } from './TransactionFormModal'

const session = vi.hoisted(() => ({ currency: 'USD' }))
vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: session.currency }),
}))
vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e1', name: 'Groceries', kind: 'expense' },
  { id: 'e2', name: 'Transport', kind: 'expense' },
  { id: 'i1', name: 'Salary', kind: 'income' },
]

const existing: Transaction = {
  id: 't1',
  kind: 'expense',
  amountMinor: 1250,
  currency: 'USD',
  categoryId: 'e1',
  date: '2026-09-15',
  note: 'Lunch',
}

beforeEach(() => {
  vi.resetAllMocks()
  session.currency = 'USD'
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

async function openCreate(onClose = () => {}) {
  renderWithProviders(<TransactionFormModal mode={{ kind: 'create' }} onClose={onClose} />)
  await screen.findByRole('option', { name: 'Groceries' })
}

describe('TransactionFormModal (create)', () => {
  it('validates before calling the API', async () => {
    await openCreate()

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Enter an amount')).toBeInTheDocument()
    expect(screen.getByText('Choose a category')).toBeInTheDocument()
    expect(financeApi.createTransaction).not.toHaveBeenCalled()
  })

  it('offers only categories of the chosen type and resets the category when the type changes', async () => {
    await openCreate()

    expect(screen.queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.click(screen.getByRole('radio', { name: 'Income' }))

    expect(screen.getByRole('option', { name: 'Salary' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^category/i)).toHaveValue('')
  })

  it('creates a transaction with the amount in integer minor units and closes', async () => {
    vi.mocked(financeApi.createTransaction).mockResolvedValue(existing)
    const onClose = vi.fn()
    await openCreate(onClose)

    await userEvent.type(screen.getByLabelText(/^amount/i), '12.50')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')
    await userEvent.type(screen.getByLabelText('Note'), 'Lunch')
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.createTransaction).mock.calls[0]?.[0]).toMatchObject({
      kind: 'expense',
      amountMinor: 1250,
      categoryId: 'e1',
      note: 'Lunch',
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it.each([
    ['JPY', '500', 500, 'Enter a valid amount in JPY', '5.5'],
    ['BHD', '1.234', 1234, 'Enter a valid amount in BHD', '1.2345'],
  ])('handles %s: accepts %s as %i minor units and rejects too many decimals', async (currency, good, minor, message, bad) => {
    session.currency = currency
    vi.mocked(financeApi.createTransaction).mockResolvedValue(existing)
    await openCreate()
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.type(screen.getByLabelText(/^amount/i), bad)
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(await screen.findByText(message)).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText(/^amount/i))
    await userEvent.type(screen.getByLabelText(/^amount/i), good)
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    await vi.waitFor(() => expect(financeApi.createTransaction).toHaveBeenCalled())
    expect(vi.mocked(financeApi.createTransaction).mock.calls[0]?.[0].amountMinor).toBe(minor)
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    vi.mocked(financeApi.createTransaction).mockRejectedValue(new Error('Network Error'))
    const onClose = vi.fn()
    await openCreate(onClose)
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))

    expect(await screen.findByText('Network Error')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TransactionFormModal (edit)', () => {
  it('fills the form and saves through update', async () => {
    vi.mocked(financeApi.updateTransaction).mockResolvedValue(existing)
    const onClose = vi.fn()
    renderWithProviders(<TransactionFormModal mode={{ kind: 'edit', transaction: existing }} onClose={onClose} />)

    expect(await screen.findByLabelText(/^amount/i)).toHaveValue('12.50')
    expect(screen.getByLabelText('Note')).toHaveValue('Lunch')
    await userEvent.clear(screen.getByLabelText(/^amount/i))
    await userEvent.type(screen.getByLabelText(/^amount/i), '20')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.updateTransaction).mock.calls[0]).toEqual([
      't1',
      { kind: 'expense', amountMinor: 2000, categoryId: 'e1', date: '2026-09-15', note: 'Lunch' },
    ])
  })

  it('asks for confirmation before deleting', async () => {
    vi.mocked(financeApi.deleteTransaction).mockResolvedValue()
    const onClose = vi.fn()
    renderWithProviders(<TransactionFormModal mode={{ kind: 'edit', transaction: existing }} onClose={onClose} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Delete transaction' }))
    expect(financeApi.deleteTransaction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(financeApi.deleteTransaction).mock.calls[0]?.[0]).toBe('t1')
  })
})
```

`frontend/src/features/finance/components/TransactionFormModal.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSessionUser } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { pushToast } from '@/shared/ui/toast'
import {
  useCategories,
  useCreateTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
} from '../api/hooks'
import {
  makeTransactionFormSchema,
  toFormValues,
  toTransactionInput,
  type TransactionFormValues,
} from '../transactionForm'
import type { Category, Transaction } from '../types'
import '../finance.css'

export type TransactionFormMode = { kind: 'create' } | { kind: 'edit'; transaction: Transaction }

interface TransactionFormModalProps {
  mode: TransactionFormMode
  onClose: () => void
}

/**
 * The form mounts only once the categories are loaded. A select whose saved value is not among
 * its options yet would start empty and lose the transaction's category on save.
 */
export function TransactionFormModal({ mode, onClose }: TransactionFormModalProps) {
  const categories = useCategories()

  return (
    <Modal title={mode.kind === 'edit' ? 'Edit transaction' : 'Add transaction'} onClose={onClose}>
      {categories.isPending && <LoadingState label="Loading categories…" />}
      {categories.isError && (
        <ErrorState message="Could not load categories" onRetry={() => categories.refetch()} />
      )}
      {categories.isSuccess && <TransactionForm mode={mode} categories={categories.data} onClose={onClose} />}
    </Modal>
  )
}

interface TransactionFormProps {
  mode: TransactionFormMode
  categories: Category[]
  onClose: () => void
}

function TransactionForm({ mode, categories, onClose }: TransactionFormProps) {
  const currency = useSessionUser()?.currency ?? 'USD'
  const editing = mode.kind === 'edit'
  const createTransaction = useCreateTransaction()
  const updateTransaction = useUpdateTransaction()
  const deleteTransaction = useDeleteTransaction()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const schema = useMemo(() => makeTransactionFormSchema(currency), [currency])
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(currency, mode.kind === 'edit' ? mode.transaction : undefined),
  })

  const kind = watch('kind')
  const options = categories.filter((category) => category.kind === kind)
  const failure = createTransaction.error ?? updateTransaction.error ?? deleteTransaction.error
  const saving = createTransaction.isPending || updateTransaction.isPending

  function onSubmit(values: TransactionFormValues) {
    const input = toTransactionInput(values, currency)
    if (mode.kind === 'edit') {
      updateTransaction.mutate(
        { id: mode.transaction.id, input },
        {
          onSuccess: () => {
            pushToast('Transaction saved', 'success')
            onClose()
          },
        },
      )
    } else {
      createTransaction.mutate(input, { onSuccess: onClose })
    }
  }

  function onDelete() {
    if (mode.kind !== 'edit') return
    deleteTransaction.mutate(mode.transaction.id, {
      onSuccess: () => {
        pushToast('Transaction deleted', 'success')
        onClose()
      },
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <fieldset className="kind-toggle">
        <legend>Type</legend>
        {(['expense', 'income'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              value={value}
              {...register('kind', { onChange: () => setValue('categoryId', '') })}
            />
            {value === 'expense' ? 'Expense' : 'Income'}
          </label>
        ))}
      </fieldset>
      <FormField label={`Amount (${currency})`} error={errors.amount?.message}>
        <input inputMode="decimal" autoComplete="off" {...register('amount')} />
      </FormField>
      <FormField label="Category" error={errors.categoryId?.message}>
        <select {...register('categoryId')}>
          <option value="">Choose…</option>
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Date" error={errors.date?.message}>
        <input type="date" {...register('date')} />
      </FormField>
      <FormField label="Note" error={errors.note?.message}>
        <input {...register('note')} />
      </FormField>

      {failure && <p className="form-error">{getErrorMessage(failure)}</p>}

      <div className="form-actions">
        {mode.kind === 'edit' &&
          (confirmingDelete ? (
            <>
              <Button variant="danger" onClick={onDelete} loading={deleteTransaction.isPending}>
                Yes, delete
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete transaction
            </Button>
          ))}
        <Button type="submit" variant="primary" loading={saving}>
          {editing ? 'Save changes' : 'Add transaction'}
        </Button>
      </div>
    </form>
  )
}
```

The `Amount` label is `Amount (USD)`, which is why the tests use `/^amount/i`. The `Category` label's text content includes its options, hence `/^category/i`. (`.form-actions` and `.form-error` are defined in the finance stylesheet in Step 6, so this slice does not depend on the tasks slice's CSS.)

Run: `npx vitest run src/features/finance/components/TransactionFormModal.test.tsx` → PASS. (`.form-actions`, `.form-error` are already styled by the tasks slice's CSS; the finance slice defines its own copy in Step 6 so it does not depend on another slice's stylesheet.)

- [ ] **Step 5: Transaction list, category manager**

`frontend/src/features/finance/components/TransactionList.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import type { Category, Transaction, TransactionPage } from '../types'
import { TransactionList } from './TransactionList'

vi.mock('../api/financeApi')

const categories: Category[] = [
  { id: 'e1', name: 'Groceries', kind: 'expense' },
  { id: 'i1', name: 'Salary', kind: 'income' },
]

function tx(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    categoryId: 'e1',
    date: '2026-09-15',
    note: `note ${id}`,
    ...overrides,
  }
}

const page = (items: Transaction[], total = items.length, current = 1): TransactionPage => ({
  items,
  page: current,
  limit: 20,
  total,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

describe('TransactionList', () => {
  it('lists transactions with date, category, note and signed, formatted amounts', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(
      page([tx('1'), tx('2', { kind: 'income', categoryId: 'i1', amountMinor: 300000, note: 'pay' })]),
    )

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    const rows = await screen.findAllByRole('row')
    expect(await within(rows[1] as HTMLElement).findByText('Groceries')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('-$12.50')).toBeInTheDocument()
    expect(await within(rows[2] as HTMLElement).findByText('Salary')).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('+$3,000.00')).toBeInTheDocument()
  })

  it('says so when there are no transactions', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([]))

    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(financeApi.listTransactions).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))

    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('note 1')).toBeInTheDocument()
  })

  it('filters by type, category and dates, always starting from page 1', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')], 60))
    renderWithProviders(<TransactionList onEdit={() => {}} />)
    await screen.findByText('note 1')

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'expense')
    await screen.findByRole('option', { name: 'Groceries' })
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'Groceries')

    await vi.waitFor(() => {
      const last = vi.mocked(financeApi.listTransactions).mock.calls.at(-1)?.[0]
      expect(last).toMatchObject({ kind: 'expense', categoryId: 'e1', page: 1 })
    })
  })

  it('pages forwards and back and shows where you are', async () => {
    vi.mocked(financeApi.listTransactions).mockImplementation(async (params) =>
      page([tx(`p${params.page}`)], 45, params.page ?? 1),
    )
    renderWithProviders(<TransactionList onEdit={() => {}} />)

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('note p2')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })

  it('opens a transaction for editing', async () => {
    vi.mocked(financeApi.listTransactions).mockResolvedValue(page([tx('1')]))
    const onEdit = vi.fn()
    renderWithProviders(<TransactionList onEdit={onEdit} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit note 1' }))

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })
})
```

`frontend/src/features/finance/components/TransactionList.tsx`:

```tsx
import { useState } from 'react'
import { formatDate } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Button } from '@/shared/ui/Button'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useCategories, useTransactions } from '../api/hooks'
import type { Transaction, TransactionFilters, TransactionKind } from '../types'
import '../finance.css'

const PAGE_SIZE = 20

interface TransactionListProps {
  onEdit: (transaction: Transaction) => void
}

export function TransactionList({ onEdit }: TransactionListProps) {
  const [filters, setFilters] = useState<TransactionFilters>({})
  const [page, setPage] = useState(1)
  const categoriesQuery = useCategories()
  const categories = categoriesQuery.data ?? []
  const query = useTransactions({ ...filters, page, limit: PAGE_SIZE })
  const categoryName = (id: string) =>
    categoriesQuery.isSuccess
      ? (categories.find((category) => category.id === id)?.name ?? 'Deleted category')
      : '…'

  /** Any filter change goes back to the first page. */
  function updateFilters(next: TransactionFilters) {
    setFilters(next)
    setPage(1)
  }

  const setFilter = <Key extends keyof TransactionFilters>(key: Key, value: string) =>
    updateFilters({ ...filters, [key]: value === '' ? undefined : value })

  const pageCount = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1
  const filtered = Object.values(filters).some(Boolean)

  return (
    <section aria-label="Transactions">
      <div className="tx-filters">
        <label>
          Type
          <select
            value={filters.kind ?? ''}
            onChange={(event) => setFilter('kind', event.target.value as TransactionKind | '')}
          >
            <option value="">All</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label>
          Category
          <select value={filters.categoryId ?? ''} onChange={(event) => setFilter('categoryId', event.target.value)}>
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={filters.from ?? ''} onChange={(event) => setFilter('from', event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={filters.to ?? ''} onChange={(event) => setFilter('to', event.target.value)} />
        </label>
      </div>

      {query.isPending && <LoadingState label="Loading transactions…" />}
      {query.isError && <ErrorState message="Could not load transactions" onRetry={() => query.refetch()} />}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState
          title={filtered ? 'No transactions match these filters' : 'No transactions yet'}
          description={filtered ? 'Try widening the dates or clearing a filter.' : 'Add your first transaction to get started.'}
        />
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <table className="tx-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Category</th>
                <th scope="col">Note</th>
                <th scope="col" className="tx-table__amount">
                  Amount
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.date)}</td>
                  <td>{categoryName(transaction.categoryId)}</td>
                  <td>{transaction.note}</td>
                  <td className={`tx-table__amount ${transaction.kind === 'income' ? 'is-positive' : ''}`}>
                    {transaction.kind === 'income' ? '+' : '-'}
                    {formatMinorUnits(transaction.amountMinor, transaction.currency)}
                  </td>
                  <td>
                    <Button variant="ghost" aria-label={`Edit ${transaction.note || 'transaction'}`} onClick={() => onEdit(transaction)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tx-pager">
            <Button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {pageCount}
            </span>
            <Button aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
```

Run: `npx vitest run src/features/finance/components/TransactionList.test.tsx` → PASS. (The amount cell test looks for `-$12.50` and `+$3,000.00`; the sign is rendered in the same cell as the money text, in two text nodes, which `getByText` joins.)

`frontend/src/features/finance/components/CategoryManager.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { CategoryManager } from './CategoryManager'

vi.mock('../api/financeApi')

const categories = [
  { id: 'e1', name: 'Groceries', kind: 'expense' as const },
  { id: 'i1', name: 'Salary', kind: 'income' as const },
]

function apiError(status: number, message: string) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: { message },
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
})

describe('CategoryManager', () => {
  it('lists expense and income categories separately', async () => {
    renderWithProviders(<CategoryManager onClose={() => {}} />)

    const expense = await screen.findByRole('list', { name: 'Expense categories' })
    const income = screen.getByRole('list', { name: 'Income categories' })
    expect(within(expense).getByText('Groceries')).toBeInTheDocument()
    expect(within(income).getByText('Salary')).toBeInTheDocument()
  })

  it('adds a category of the chosen type', async () => {
    vi.mocked(financeApi.createCategory).mockResolvedValue({ id: 'e2', name: 'Pets', kind: 'income' })
    renderWithProviders(<CategoryManager onClose={() => {}} />)
    await screen.findByText('Groceries')

    await userEvent.type(screen.getByLabelText('New category name'), 'Pets')
    await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'income')
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

    await vi.waitFor(() => expect(financeApi.createCategory).toHaveBeenCalled())
    expect(vi.mocked(financeApi.createCategory).mock.calls[0]?.[0]).toEqual({ name: 'Pets', kind: 'income' })
  })

  it('does not add a blank name', async () => {
    renderWithProviders(<CategoryManager onClose={() => {}} />)
    await screen.findByText('Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))

    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(financeApi.createCategory).not.toHaveBeenCalled()
  })

  it('renames a category and shows the duplicate-name message when refused', async () => {
    vi.mocked(financeApi.renameCategory).mockRejectedValue(
      apiError(409, 'A category with that name already exists'),
    )
    renderWithProviders(<CategoryManager onClose={() => {}} />)
    await screen.findByText('Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Rename Groceries' }))
    const field = screen.getByLabelText('New name for Groceries')
    await userEvent.clear(field)
    await userEvent.type(field, 'Salary')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByText('A category with that name already exists')).toBeInTheDocument()
    expect(vi.mocked(financeApi.renameCategory).mock.calls[0]).toEqual(['e1', 'Salary'])
  })

  it('explains why a category in use cannot be deleted', async () => {
    vi.mocked(financeApi.deleteCategory).mockRejectedValue(
      apiError(409, '2 transactions use this category. Reassign or delete them first.'),
    )
    renderWithProviders(<CategoryManager onClose={() => {}} />)
    await screen.findByText('Groceries')

    await userEvent.click(screen.getByRole('button', { name: 'Delete Groceries' }))

    expect(await screen.findByText(/2 transactions use this category/)).toBeInTheDocument()
    expect(vi.mocked(financeApi.deleteCategory).mock.calls[0]?.[0]).toBe('e1')
  })
})
```

`frontend/src/features/finance/components/CategoryManager.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Modal } from '@/shared/ui/Modal'
import { ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useCategories, useCreateCategory, useDeleteCategory, useRenameCategory } from '../api/hooks'
import type { Category, TransactionKind } from '../types'
import '../finance.css'

function CategoryRow({ category }: { category: Category }) {
  const rename = useRenameCategory()
  const remove = useDeleteCategory()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const failure = rename.error ?? remove.error

  return (
    <li className="category-row">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            rename.mutate({ id: category.id, name }, { onSuccess: () => setEditing(false) })
          }}
        >
          <input
            aria-label={`New name for ${category.name}`}
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="primary" loading={rename.isPending}>
            Save name
          </Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <>
          <span>{category.name}</span>
          <Button variant="ghost" aria-label={`Rename ${category.name}`} onClick={() => setEditing(true)}>
            Rename
          </Button>
          <Button
            variant="ghost"
            aria-label={`Delete ${category.name}`}
            loading={remove.isPending}
            onClick={() => remove.mutate(category.id)}
          >
            Delete
          </Button>
        </>
      )}
      {failure && <p className="form-error">{getErrorMessage(failure)}</p>}
    </li>
  )
}

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const query = useCategories()
  const create = useCreateCategory()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<TransactionKind>('expense')
  const [nameError, setNameError] = useState<string | null>(null)

  function onAdd(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setNameError('Enter a name')
      return
    }
    setNameError(null)
    create.mutate({ name: name.trim(), kind }, { onSuccess: () => setName('') })
  }

  return (
    <Modal title="Categories" onClose={onClose}>
      {query.isPending && <LoadingState label="Loading categories…" />}
      {query.isError && <ErrorState message="Could not load categories" onRetry={() => query.refetch()} />}
      {query.isSuccess &&
        (['expense', 'income'] as const).map((groupKind) => (
          <div key={groupKind}>
            <h3>{groupKind === 'expense' ? 'Expense' : 'Income'}</h3>
            <ul className="category-list" aria-label={`${groupKind === 'expense' ? 'Expense' : 'Income'} categories`}>
              {query.data
                .filter((category) => category.kind === groupKind)
                .map((category) => (
                  <CategoryRow key={category.id} category={category} />
                ))}
            </ul>
          </div>
        ))}

      <form className="category-add" onSubmit={onAdd} noValidate>
        <label>
          New category name
          <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Type
          <select value={kind} onChange={(event) => setKind(event.target.value as TransactionKind)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add category
        </Button>
        {nameError && <p className="form-error">{nameError}</p>}
        {create.isError && <p className="form-error">{getErrorMessage(create.error)}</p>}
      </form>
    </Modal>
  )
}
```

Run: `npx vitest run src/features/finance/components/CategoryManager.test.tsx` → PASS.

- [ ] **Step 6: Add the styles**

Append to `frontend/src/features/finance/finance.css`:

```css
.month-picker {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.month-picker input,
.tx-filters select,
.tx-filters input,
.category-add input,
.category-add select,
.category-row input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}
.summary-cards__value {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
}
.is-positive {
  color: var(--positive);
}
.is-negative {
  color: var(--danger);
}

.kind-toggle {
  display: flex;
  gap: var(--space-4);
  margin: 0 0 var(--space-4);
  padding: 0;
  border: 0;
}
.kind-toggle legend {
  margin-bottom: var(--space-1);
  color: var(--text-muted);
  font-size: 0.9rem;
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
.form-error {
  color: var(--danger);
}

.tx-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.tx-filters label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: 0.85rem;
}
.tx-table {
  width: 100%;
  border-collapse: collapse;
}
.tx-table th,
.tx-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.tx-table__amount {
  text-align: right;
  white-space: nowrap;
}
.tx-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.category-list {
  margin: 0 0 var(--space-4);
  padding: 0;
  list-style: none;
}
.category-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
}
.category-row > span {
  margin-right: auto;
}
.category-row .form-error {
  flex-basis: 100%;
  margin: 0;
}
.category-add {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.category-add label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: 0.85rem;
}
```

- [ ] **Step 7: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(finance): add month picker, summary cards, transaction form, list and category manager" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: CSV import dialog

**Files:**
- Create: `frontend/src/features/finance/components/ImportDialog.tsx`, `components/ImportDialog.test.tsx`
- Modify: `frontend/src/features/finance/finance.css` (append)

**Interfaces:**
- Consumes: `parseCsv`, `mapRows`, `guessColumns`, `countExistingDuplicates`, `chunk`, `DATE_FORMATS`, `useCategories`, `useBulkCreateTransactions`, `listAllTransactionsInRange`.
- Produces: `ImportDialog({ onClose })`. Flow: pick a file, map columns and pick default categories, see a preview (rows ready, rows with problems listed by number, possible duplicates), import in batches of 500 with progress, see the result.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/finance/components/ImportDialog.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import { ImportDialog } from './ImportDialog'

vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: 'USD' }),
}))
vi.mock('../api/financeApi')

const categories = [
  { id: 'e-other', name: 'Other', kind: 'expense' as const },
  { id: 'e-food', name: 'Groceries', kind: 'expense' as const },
  { id: 'i-other', name: 'Other', kind: 'income' as const },
  { id: 'i-pay', name: 'Salary', kind: 'income' as const },
]

const CSV = [
  'Date,Description,Amount',
  '2026-09-01,Coffee,-4.50',
  '2026-09-02,Salary,3000.00',
  'not a date,Broken,-1.00',
  '2026-09-03,"Lunch, with client",-25.00',
].join('\n')

function upload(csv: string) {
  return userEvent.upload(
    screen.getByLabelText('CSV file'),
    new File([csv], 'bank.csv', { type: 'text/csv' }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
  vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue([])
  vi.mocked(financeApi.bulkCreateTransactions).mockImplementation(async (rows) => ({ created: rows.length }))
})

describe('ImportDialog', () => {
  it('asks for a file first', () => {
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    expect(screen.getByLabelText('CSV file')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument()
  })

  it('previews the rows: how many are ready and which have problems', async () => {
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    await upload(CSV)

    expect(await screen.findByText('3 rows ready to import')).toBeInTheDocument()
    expect(screen.getByText('1 row has a problem and will be skipped')).toBeInTheDocument()
    expect(screen.getByText('Row 4: Could not read the date "not a date"')).toBeInTheDocument()
  })

  it('guesses the columns from the header and defaults to the "Other" categories', async () => {
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    expect(screen.getByLabelText(/^date column/i)).toHaveValue('0')
    expect(screen.getByLabelText(/^amount column/i)).toHaveValue('2')
    expect(screen.getByLabelText(/^note column/i)).toHaveValue('1')
    expect(screen.getByLabelText(/^category for spending/i)).toHaveValue('e-other')
    expect(screen.getByLabelText(/^category for income/i)).toHaveValue('i-other')
  })

  it('imports the good rows with the chosen categories and reports the result', async () => {
    renderWithProviders(<ImportDialog onClose={() => {}} />)
    await upload(CSV)
    await screen.findByText('3 rows ready to import')

    await userEvent.selectOptions(screen.getByLabelText(/^category for spending/i), 'e-food')
    await userEvent.click(screen.getByRole('button', { name: 'Import 3 transactions' }))

    expect(await screen.findByText('Imported 3 transactions')).toBeInTheDocument()
    expect(vi.mocked(financeApi.bulkCreateTransactions).mock.calls[0]?.[0]).toEqual([
      { kind: 'expense', amountMinor: 450, categoryId: 'e-food', date: '2026-09-01', note: 'Coffee' },
      { kind: 'income', amountMinor: 300000, categoryId: 'i-other', date: '2026-09-02', note: 'Salary' },
      { kind: 'expense', amountMinor: 2500, categoryId: 'e-food', date: '2026-09-03', note: 'Lunch, with client' },
    ])
  })

  it('re-reads the file when the date format or sign convention changes', async () => {
    renderWithProviders(<ImportDialog onClose={() => {}} />)
    await upload('Date,Description,Amount\n05/09/2026,Coffee,4.50\n')
    expect(await screen.findByText('0 rows ready to import')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/^date format/i), 'DD/MM/YYYY')
    await userEvent.click(screen.getByLabelText('Positive amounts are spending'))

    expect(await screen.findByText('1 row ready to import')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 transaction' }))
    await screen.findByText('Imported 1 transaction')
    expect(vi.mocked(financeApi.bulkCreateTransactions).mock.calls[0]?.[0]?.[0]).toMatchObject({
      kind: 'expense',
      date: '2026-09-05',
    })
  })

  it('warns about rows that already exist, without blocking the import', async () => {
    vi.mocked(financeApi.listAllTransactionsInRange).mockResolvedValue([
      { id: 't', kind: 'expense', amountMinor: 450, currency: 'USD', categoryId: 'e-other', date: '2026-09-01', note: 'coffee' },
    ])
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    await upload(CSV)

    expect(await screen.findByText(/1 row looks like a transaction you already have/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 transactions' })).toBeEnabled()
  })

  it('sends large files in batches of 200 rows', async () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `2026-09-01,Item ${i},-1.00`)
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    await upload(['Date,Description,Amount', ...lines].join('\n'))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 1200 transactions' }))

    expect(await screen.findByText('Imported 1200 transactions')).toBeInTheDocument()
    expect(vi.mocked(financeApi.bulkCreateTransactions).mock.calls.map(([rows]) => rows.length)).toEqual([
      200, 200, 200, 200, 200, 200,
    ])
  })

  it('stops and says how many were imported when a batch fails', async () => {
    vi.mocked(financeApi.bulkCreateTransactions)
      .mockImplementationOnce(async (rows) => ({ created: rows.length }))
      .mockRejectedValueOnce(new Error('Network Error'))
    const lines = Array.from({ length: 700 }, (_, i) => `2026-09-01,Item ${i},-1.00`)
    renderWithProviders(<ImportDialog onClose={() => {}} />)

    await upload(['Date,Description,Amount', ...lines].join('\n'))
    await userEvent.click(await screen.findByRole('button', { name: 'Import 700 transactions' }))

    expect(await screen.findByText(/200 of 700 were imported/)).toBeInTheDocument()
    expect(screen.getByText('Network Error')).toBeInTheDocument()
  })

  it('handles a file with only a header, and an empty file', async () => {
    const { unmount } = renderWithProviders(<ImportDialog onClose={() => {}} />)
    await upload('Date,Description,Amount\n')
    expect(await screen.findByText('0 rows ready to import')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(<ImportDialog onClose={() => {}} />)
    await upload('')
    expect(await screen.findByText('That file has no rows')).toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/features/finance/components/ImportDialog.test.tsx` → FAIL (module missing).

- [ ] **Step 2: Implement the dialog**

`frontend/src/features/finance/components/ImportDialog.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState, type ChangeEvent } from 'react'
import { useSessionUser } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Modal } from '@/shared/ui/Modal'
import { listAllTransactionsInRange } from '../api/financeApi'
import { financeKeys } from '../api/financeKeys'
import { useBulkCreateTransactions, useCategories } from '../api/hooks'
import { parseCsv } from '../csv'
import {
  chunk,
  countExistingDuplicates,
  DATE_FORMATS,
  guessColumns,
  mapRows,
  type DateFormat,
  type ImportMapping,
} from '../csvImport'
import '../finance.css'

// 200 rows with 200-character notes is about 70 KB, comfortably under the API's 100 KB body limit.
const BATCH_SIZE = 200

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const currency = useSessionUser()?.currency ?? 'USD'
  const { data: categories = [] } = useCategories()
  const bulk = useBulkCreateTransactions()

  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [dateColumn, setDateColumn] = useState(0)
  const [amountColumn, setAmountColumn] = useState(1)
  const [noteColumn, setNoteColumn] = useState<number | null>(null)
  const [dateFormat, setDateFormat] = useState<DateFormat>('YYYY-MM-DD')
  const [negativeIsExpense, setNegativeIsExpense] = useState(true)
  const [expenseChoice, setExpenseChoice] = useState('')
  const [incomeChoice, setIncomeChoice] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<{ done: number; total: number; error: string | null } | null>(null)

  const expenseCategories = categories.filter((category) => category.kind === 'expense')
  const incomeCategories = categories.filter((category) => category.kind === 'income')
  const preferred = (list: typeof categories) =>
    (list.find((category) => category.name === 'Other') ?? list[0])?.id ?? ''
  const expenseCategoryId = expenseChoice || preferred(expenseCategories)
  const incomeCategoryId = incomeChoice || preferred(incomeCategories)

  const mapped = useMemo(() => {
    if (!rows) return { valid: [], errors: [] }
    const mapping: ImportMapping = {
      dateColumn,
      amountColumn,
      noteColumn,
      dateFormat,
      negativeIsExpense,
      expenseCategoryId,
      incomeCategoryId,
      currency,
    }
    return mapRows(rows, mapping, hasHeader)
  }, [
    rows,
    hasHeader,
    dateColumn,
    amountColumn,
    noteColumn,
    dateFormat,
    negativeIsExpense,
    expenseCategoryId,
    incomeCategoryId,
    currency,
  ])

  const dates = mapped.valid.map((row) => row.date).sort()
  const first = dates[0]
  const last = dates.at(-1)
  const existing = useQuery({
    queryKey: financeKeys.existingInRange(first ?? '', last ?? ''),
    queryFn: () => listAllTransactionsInRange(first ?? '', last ?? ''),
    enabled: first !== undefined && last !== undefined,
  })
  const duplicates = existing.data ? countExistingDuplicates(mapped.valid, existing.data) : 0

  const columnCount = rows ? Math.max(0, ...rows.map((row) => row.length)) : 0
  const headerRow = rows?.[0]
  const columnName = (index: number) => {
    const name = headerRow?.[index]
    return hasHeader && name ? `${index + 1}: ${name}` : `Column ${index + 1}`
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setOutcome(null)
    setFileError(null)
    const parsed = parseCsv(await readFileText(file))
    if (parsed.length === 0) {
      setRows(null)
      setFileError('That file has no rows')
      return
    }
    const guess = guessColumns(parsed[0] ?? [])
    setRows(parsed)
    setDateColumn(guess.dateColumn)
    setAmountColumn(guess.amountColumn)
    setNoteColumn(guess.noteColumn)
  }

  async function runImport() {
    const total = mapped.valid.length
    let done = 0
    setProgress({ done, total })
    try {
      for (const batch of chunk(mapped.valid, BATCH_SIZE)) {
        await bulk.mutateAsync(batch)
        done += batch.length
        setProgress({ done, total })
      }
      setOutcome({ done, total, error: null })
    } catch (error) {
      setOutcome({ done, total, error: getErrorMessage(error) })
    } finally {
      setProgress(null)
    }
  }

  const ready = mapped.valid.length
  const problems = mapped.errors.length

  return (
    <Modal title="Import transactions from CSV" onClose={onClose}>
      {outcome ? (
        <div>
          {outcome.error === null ? (
            <p role="status">Imported {plural(outcome.done, 'transaction', 'transactions')}</p>
          ) : (
            <>
              <p role="alert">
                Stopped early: {outcome.done} of {outcome.total} were imported. The rest were not.
              </p>
              <p className="form-error">{outcome.error}</p>
            </>
          )}
          <div className="form-actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="import">
          <label className="import__file">
            CSV file
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
          </label>
          {fileError && <p className="form-error">{fileError}</p>}

          {rows && (
            <>
              <label className="import__check">
                <input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} />
                First row is a header
              </label>
              <div className="import__grid">
                <label>
                  Date column
                  <select value={dateColumn} onChange={(event) => setDateColumn(Number(event.target.value))}>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <option key={index} value={index}>
                        {columnName(index)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount column
                  <select value={amountColumn} onChange={(event) => setAmountColumn(Number(event.target.value))}>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <option key={index} value={index}>
                        {columnName(index)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note column
                  <select
                    value={noteColumn ?? ''}
                    onChange={(event) => setNoteColumn(event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <option value="">None</option>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <option key={index} value={index}>
                        {columnName(index)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date format
                  <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value as DateFormat)}>
                    {DATE_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category for spending
                  <select value={expenseCategoryId} onChange={(event) => setExpenseChoice(event.target.value)}>
                    {expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category for income
                  <select value={incomeCategoryId} onChange={(event) => setIncomeChoice(event.target.value)}>
                    {incomeCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="import__check">
                <input
                  type="checkbox"
                  checked={!negativeIsExpense}
                  onChange={(event) => setNegativeIsExpense(!event.target.checked)}
                />
                Positive amounts are spending
              </label>
              <p className="muted">
                By default a negative amount is spending and a positive amount is income. Tick the box for card
                exports that list purchases as positive numbers.
              </p>

              <p>{plural(ready, 'row', 'rows')} ready to import</p>
              {problems > 0 && (
                <>
                  <p role="alert">
                    {plural(problems, 'row has a problem', 'rows have problems')} and will be skipped
                  </p>
                  <ul className="import__errors">
                    {mapped.errors.slice(0, 10).map((error) => (
                      <li key={error.row}>{`Row ${error.row}: ${error.message}`}</li>
                    ))}
                    {problems > 10 && <li>…and {problems - 10} more</li>}
                  </ul>
                </>
              )}
              {duplicates > 0 && (
                <p className="muted">
                  {plural(duplicates, 'row looks like a transaction you already have', 'rows look like transactions you already have')}.
                  They will still be imported.
                </p>
              )}

              <div className="form-actions">
                {ready > 0 && (
                  <Button
                    variant="primary"
                    onClick={runImport}
                    loading={progress !== null}
                    disabled={!expenseCategoryId || !incomeCategoryId}
                  >
                    {`Import ${plural(ready, 'transaction', 'transactions')}`}
                  </Button>
                )}
              </div>
              {progress && (
                <p role="status">
                  Imported {progress.done} of {progress.total}…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
```

Append to `finance.css`:

```css
.import {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.import label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: 0.85rem;
}
.import select,
.import input[type='file'] {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.import__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}
.import label.import__check {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  color: var(--text);
  font-size: 1rem;
}
.import__errors {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--danger);
}
```

Run: `npx vitest run src/features/finance/components/ImportDialog.test.tsx` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(finance): add CSV import dialog with preview, duplicate warning and batching" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: The Finance page, routes and navigation

**Files:**
- Create: `frontend/src/features/finance/pages/FinancePage.tsx`, `pages/FinancePage.test.tsx`, `routes.ts`, `index.ts`
- Modify: `frontend/src/app/navigation.ts`, `frontend/src/app/router.ts`

**Interfaces:**
- Produces (from `@/features/finance`): `financeRoutes: RouteObject[]` (path `finance`), `useMonthSummary`, `SpendingByCategoryChart`, `IncomeExpenseChart`.

- [ ] **Step 1: Write the failing page tests**

`frontend/src/features/finance/pages/FinancePage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentMonthIso, shiftMonthIso } from '@/shared/lib/dates'
import { renderWithProviders } from '@/test/render'
import * as financeApi from '../api/financeApi'
import FinancePage from './FinancePage'

vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: 'USD' }),
}))
vi.mock('../api/financeApi')
vi.mock('react-chartjs-2', () => ({
  Doughnut: () => <div data-testid="doughnut" />,
  Bar: () => <div data-testid="bar" />,
  Line: () => <div data-testid="line" />,
}))

const categories = [{ id: 'e1', name: 'Groceries', kind: 'expense' as const }]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(financeApi.listCategories).mockResolvedValue(categories)
  vi.mocked(financeApi.fetchSummary).mockImplementation(async (month) => ({
    month,
    currency: 'USD',
    incomeMinor: 300000,
    expenseMinor: 8700,
    netMinor: 291300,
  }))
  vi.mocked(financeApi.fetchSpendingByCategory).mockResolvedValue({
    month: '',
    currency: 'USD',
    items: [{ categoryId: 'e1', name: 'Groceries', totalMinor: 8700 }],
  })
  vi.mocked(financeApi.fetchMonthlyTotals).mockResolvedValue({
    currency: 'USD',
    items: [{ month: '2026-09', incomeMinor: 300000, expenseMinor: 8700, netMinor: 291300 }],
  })
  vi.mocked(financeApi.fetchBalanceTrend).mockResolvedValue({
    currency: 'USD',
    openingMinor: 0,
    items: [{ month: '2026-09', balanceMinor: 291300 }],
  })
  vi.mocked(financeApi.listTransactions).mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 })
})

describe('FinancePage', () => {
  it('shows the summary cards, all three charts and the transaction list', async () => {
    renderWithProviders(<FinancePage />)

    expect((await screen.findAllByText('$3,000.00')).length).toBeGreaterThan(0)
    expect(await screen.findByTestId('doughnut')).toBeInTheDocument()
    expect(await screen.findByTestId('bar')).toBeInTheDocument()
    expect(await screen.findByTestId('line')).toBeInTheDocument()
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument()
  })

  it('starts on the current month and reloads the month-based views when it changes', async () => {
    renderWithProviders(<FinancePage />)
    await screen.findAllByText('$3,000.00')
    const current = currentMonthIso()
    expect(vi.mocked(financeApi.fetchSummary).mock.calls[0]?.[0]).toBe(current)

    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))

    const previous = shiftMonthIso(current, -1)
    await vi.waitFor(() => expect(vi.mocked(financeApi.fetchSummary).mock.calls.at(-1)?.[0]).toBe(previous))
    expect(vi.mocked(financeApi.fetchSpendingByCategory).mock.calls.at(-1)?.[0]).toBe(previous)
  })

  it('switches the bar and line charts between six and twelve months', async () => {
    renderWithProviders(<FinancePage />)
    await screen.findByTestId('bar')

    await userEvent.selectOptions(screen.getByLabelText(/^chart range/i), '12')

    await vi.waitFor(() => expect(vi.mocked(financeApi.fetchMonthlyTotals).mock.calls.at(-1)?.[0]).toBe(12))
    expect(vi.mocked(financeApi.fetchBalanceTrend).mock.calls.at(-1)?.[0]).toBe(12)
  })

  it('opens the add-transaction, import and category dialogs', async () => {
    renderWithProviders(<FinancePage />)
    await screen.findAllByText('$3,000.00')

    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    await userEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(screen.getByRole('dialog', { name: 'Import transactions from CSV' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))

    await userEvent.click(screen.getByRole('button', { name: 'Categories' }))
    expect(screen.getByRole('dialog', { name: 'Categories' })).toBeInTheDocument()
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the page, routes and public API**

`frontend/src/features/finance/pages/FinancePage.tsx`:

```tsx
import { useState } from 'react'
import { currentMonthIso } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { CategoryManager } from '../components/CategoryManager'
import { ImportDialog } from '../components/ImportDialog'
import { IncomeExpenseChart } from '../components/IncomeExpenseChart'
import { MonthPicker } from '../components/MonthPicker'
import { NetTrendChart } from '../components/NetTrendChart'
import { SpendingByCategoryChart } from '../components/SpendingByCategoryChart'
import { SummaryCards } from '../components/SummaryCards'
import { TransactionFormModal, type TransactionFormMode } from '../components/TransactionFormModal'
import { TransactionList } from '../components/TransactionList'
import type { RangeMonths } from '../types'
import '../finance.css'

type Dialog = { kind: 'transaction'; mode: TransactionFormMode } | { kind: 'import' } | { kind: 'categories' } | null

export default function FinancePage() {
  const [month, setMonth] = useState(currentMonthIso())
  const [months, setMonths] = useState<RangeMonths>(6)
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)

  return (
    <div className="finance">
      <div className="finance__header">
        <h1>Finance</h1>
        <MonthPicker value={month} onChange={setMonth} />
        <div className="finance__actions">
          <Button onClick={() => setDialog({ kind: 'categories' })}>Categories</Button>
          <Button onClick={() => setDialog({ kind: 'import' })}>Import CSV</Button>
          <Button variant="primary" onClick={() => setDialog({ kind: 'transaction', mode: { kind: 'create' } })}>
            Add transaction
          </Button>
        </div>
      </div>

      <SummaryCards month={month} />

      <div className="finance__charts">
        <Card title="Where the money went">
          <SpendingByCategoryChart month={month} />
        </Card>
        <div className="finance__range">
          <label>
            Chart range
            <select value={months} onChange={(event) => setMonths(Number(event.target.value) as RangeMonths)}>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          </label>
        </div>
        <Card title="Income vs expenses">
          <IncomeExpenseChart months={months} />
        </Card>
        <Card title="Balance">
          <NetTrendChart months={months} />
        </Card>
      </div>

      <Card title="Transactions">
        <TransactionList onEdit={(transaction) => setDialog({ kind: 'transaction', mode: { kind: 'edit', transaction } })} />
      </Card>

      {dialog?.kind === 'transaction' && <TransactionFormModal mode={dialog.mode} onClose={close} />}
      {dialog?.kind === 'import' && <ImportDialog onClose={close} />}
      {dialog?.kind === 'categories' && <CategoryManager onClose={close} />}
    </div>
  )
}
```

Append to `finance.css`:

```css
.finance {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.finance__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.finance__header h1 {
  margin: 0 var(--space-3) 0 0;
}
.finance__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-left: auto;
}
.finance__charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}
.finance__range {
  grid-column: 1 / -1;
}
.finance__range label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
}
.finance__range select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
```

`frontend/src/features/finance/routes.ts`:

```ts
import type { RouteObject } from 'react-router'

export const financeRoutes: RouteObject[] = [
  {
    path: 'finance',
    lazy: async () => ({ Component: (await import('./pages/FinancePage')).default }),
  },
]
```

`frontend/src/features/finance/index.ts`:

```ts
export { useMonthSummary } from './api/hooks'
export { IncomeExpenseChart } from './components/IncomeExpenseChart'
export { SpendingByCategoryChart } from './components/SpendingByCategoryChart'
export { financeRoutes } from './routes'
```

In `frontend/src/app/navigation.ts` add `{ to: '/finance', label: 'Finance' }` after Board. In `frontend/src/app/router.ts` add `import { financeRoutes } from '@/features/finance'` and change the shell's children to `[...dashboardRoutes, ...taskRoutes, ...financeRoutes]`.

Run: `npx vitest run src/features/finance/pages` → PASS.

- [ ] **Step 3: Run all checks**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass. The build proves `chart.js`, `react-chartjs-2` and the lazy route bundle correctly.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(finance): add the finance page with charts, list and dialogs" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Real-browser check and milestone wrap-up

Canvas charts and the file picker cannot be proven in jsdom, so check them by hand (setup: see M1 Task 13).

- [ ] **Step 1: Walk the flows**

| Do this | Expect |
|---|---|
| Open **Finance** with no data | Three summary cards at `$0.00`, "No spending this month", "No income or expenses yet", "No balance to show yet", "No transactions yet" |
| **Categories** | 11 expense and 5 income defaults; add "Pets", rename it, delete it |
| **Add transaction**: expense 12.50 Groceries; income 3000 Salary; expense 45.10 Transport | Cards update: income 3,000.00, expenses 57.60, net 2,942.40; the doughnut shows two segments; the bar and line charts show this month |
| Edit a transaction's amount, then delete one (with confirmation) | Totals and charts follow |
| Delete a category that has transactions | Refused with a message that says how many |
| Use the month arrows and the picker | Everything month-based changes; the list is independent |
| Change **Chart range** to 12 months | The bar and line charts widen |
| Toggle the light theme | Chart colours, axis text and grid change with it (reload to confirm they also start correctly) |
| Filter the list by type, category and dates; page through 20+ rows | Filters reset to page 1; page count is right |
| **Import CSV** with the sample below | 3 rows ready, 1 problem listed by row, the columns guessed; after import the list and charts update |
| Import the same file again | A warning that rows already exist, and they are still imported if you proceed |
| Sign up a second user in a private window, use the app | Sees none of the first user's data, and gets the default categories |
| Register with currency JPY, add `500` | Shown as `¥500`, no decimals; try `5.5` and see the error |

Sample CSV (save as `bank.csv`):

```
Date,Description,Amount
2026-09-01,Coffee,-4.50
2026-09-02,Salary,3000.00
not a date,Broken row,-1.00
2026-09-03,"Lunch, with client",-25.00
```

- [ ] **Step 2: Run the complete checks and finish the branch**

```bash
(cd backend && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
git status
```

Expected: everything passes, tree clean. Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `feature/finance-charts` into `main`.
