import { Types, type PipelineStage } from 'mongoose'
import { monthRange, shiftMonth } from '../../shared/dates/calendarDate.ts'
import { Category, type CategoryKind } from './category.model.ts'
import { Transaction } from './transaction.model.ts'
import { requireProfile } from './transaction.service.ts'

interface Totals {
  income: number
  expense: number
}

interface MonthTotals {
  month: string
  incomeMinor: number
  expenseMinor: number
  netMinor: number
}

const DELETED_CATEGORY_NAME = 'Deleted category'

/*
 * Sums are integer `$sum`s of `amountMinor` (no division, no floats). Mongo adds the stored numbers
 * as doubles, which is exact while every partial total stays below 2^53 (about 9.0e15 minor units,
 * or roughly 9,000 transactions of the 1e12 maximum in one bucket).
 */

/**
 * Every pipeline starts with a $match on userId as an ObjectId. Aggregations do not cast, so a
 * string userId would silently match nothing, and omitting it would match every user.
 * The window is `[start, end)`; a null start means "from the beginning of time".
 */
function dateMatch(owner: Types.ObjectId, start: Date | null, end: Date): PipelineStage.Match {
  return { $match: { userId: owner, date: start ? { $gte: start, $lt: end } : { $lt: end } } }
}

async function totalsBetween(
  owner: Types.ObjectId,
  start: Date | null,
  end: Date,
): Promise<Totals> {
  const rows = await Transaction.aggregate<{ _id: CategoryKind; total: number }>([
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
  const [profile, totals] = await Promise.all([
    requireProfile(userId),
    totalsBetween(owner, start, end),
  ])
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
  // Names come from the user's own categories only; anything else reads as a deleted category.
  const categories = await Category.find({
    _id: { $in: rows.map((row) => row._id) },
    userId: owner,
  })
    .select('name')
    .lean<{ _id: Types.ObjectId; name: string }[]>()
  const nameById = new Map(categories.map((category) => [category._id.toString(), category.name]))

  return {
    month,
    currency: profile.currency,
    items: rows.map((row) => ({
      categoryId: row._id.toString(),
      name: nameById.get(row._id.toString()) ?? DELETED_CATEGORY_NAME,
      totalMinor: row.total,
    })),
  }
}

/** The `count` months ending at `to`, oldest first. */
function monthsEndingAt(to: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(to, index - (count - 1)))
}

async function monthlyTotals(
  owner: Types.ObjectId,
  to: string,
  count: number,
): Promise<MonthTotals[]> {
  const { start } = monthRange(shiftMonth(to, -(count - 1)))
  const { end } = monthRange(to)

  const rows = await Transaction.aggregate<{
    _id: { month: string; kind: CategoryKind }
    total: number
  }>([
    dateMatch(owner, start, end),
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' } },
          kind: '$kind',
        },
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
  const [profile, items] = await Promise.all([
    requireProfile(userId),
    monthlyTotals(owner, to, count),
  ])
  return { currency: profile.currency, items }
}

export async function balanceTrend(userId: string, count: number, to: string) {
  const owner = new Types.ObjectId(userId)
  const { start: windowStart } = monthRange(shiftMonth(to, -(count - 1)))

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
