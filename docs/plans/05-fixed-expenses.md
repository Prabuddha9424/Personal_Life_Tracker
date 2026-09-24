# M4 Fixed Expenses and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0 to M3 must be merged.

**Goal:** Recurring bills (weekly, monthly, yearly) with a per-bill reminder lead time, an idempotent daily job that emails reminders and rolls due dates forward, and a scheduled GitHub Actions workflow that triggers it.

**Architecture:** Backend slice `features/fixed-expenses`: a pure recurrence module (every occurrence is derived from the anchor date, so month-end clamping never drifts), CRUD endpoints, and a reminder service that claims each occurrence with a conditional update before sending, so retries and concurrent runs never double-send. The job is reached through `POST /api/internal/reminders/run`, guarded by the cron secret. Frontend slice `features/fixed-expenses`: a Bills page and form.

**Tech Stack:** Express 5, Mongoose 9, Zod 4, Nodemailer (existing mailer); React 19, TanStack Query, React Hook Form + Zod; GitHub Actions.

**Spec:** [`../PRD.md`](../PRD.md) FIX-1 to FIX-8, section 6.3, NFR-1, NFR-5.

## Global Constraints

- Money is an integer in minor units (`amountMinor`, 1 to 1 000 000 000 000) plus the user's currency code. Dates are calendar dates (`YYYY-MM-DD` on the wire, UTC midnight in Mongo). The reminder day is the UTC day of the job run (PRD Q3).
- Recurrence: weekly, monthly, yearly. Month-end bills clamp to the last day of shorter months and **never drift**: every occurrence is computed from the original anchor date, not from the previous occurrence.
- Each occurrence is emailed **at most once**. The job is idempotent, safe to retry, safe to run concurrently, and catches up after missed days (one email, then the date advances).
- Every user-facing query includes `userId` (`authUserId(req)`). The reminder job is the one cross-tenant reader, guarded by `requireCronSecret`; **every write it makes is filtered by `{ _id, userId }`**.
- Reminder emails contain only the bill's name, amount, currency, due date and a link to the app: no tokens, no other users' data. A bill name must be a single line (it goes in the subject).
- The fixed-expenses slice reaches the auth slice only through `import { getUserProfile } from '../auth/index.ts'`. It does not depend on the finance slice: bills are standalone reminders.
- Index `{ userId, nextDueDate }` and `{ active, nextDueDate }` (for the job). Paginate lists, `.lean()` for reads, validate with Zod through `validate`.
- Work on branch `feature/fixed-expenses-reminders`. Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Lint, typecheck and tests must pass before each commit.

## Review Focus

1. **Month-end recurrence.** Bills anchored on the 29th, 30th and 31st and on 29 February land on the last day of shorter months, and come back to the anchor day afterwards (31 Jan, 28 Feb, 31 Mar, 30 Apr). A yearly 29 February bill is 28 February in common years and 29 in leap years. [Task 1 tests]
2. **The job run twice, or concurrently.** No duplicate email. [Task 5 tests]
3. **Missed days.** A bill overdue for days with no reminder gets exactly one email and its date advances to the next occurrence on or after today; a weekly bill missed for weeks jumps to the right weekday. [Task 5 tests]
4. **Mail outage.** A failed send releases its claim, is counted as failed, does not advance an overdue bill, and is retried by the next run. [Task 5 test]
5. **A stale or foreign request.** The endpoint rejects a missing or wrong secret, and the job never emails a user about another user's bill. [Tasks 5 and 6 tests]
6. **Changing the schedule.** Editing the anchor date or recurrence recomputes the next due date and allows a fresh reminder; editing only the amount does neither. Resuming a paused bill recomputes its date from today. [Task 3 tests]

---

## Part A: Backend

### Task 1: Recurrence maths

**Files:**
- Create: `backend/src/features/fixed-expenses/recurrence.ts`, `recurrence.test.ts`, `fixed-expense.recurrence-types.ts`

**Interfaces:**
- Produces: `RECURRENCES = ['weekly', 'monthly', 'yearly'] as const`, `type Recurrence`; `occurrence(anchor: Date, recurrence: Recurrence, n: number): Date` (the n-th occurrence, 0 is the anchor); `firstOccurrenceOnOrAfter(anchor: Date, recurrence: Recurrence, date: Date): Date` (the earliest occurrence that is not before `date`).

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/fixed-expenses-reminders
```

- [ ] **Step 1: Write the failing tests**

`backend/src/features/fixed-expenses/recurrence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatCalendarDate, parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { firstOccurrenceOnOrAfter, occurrence } from './recurrence.ts'

const d = parseCalendarDate
const iso = formatCalendarDate

describe('occurrence', () => {
  it('repeats weekly on the same weekday', () => {
    expect([0, 1, 2, 5].map((n) => iso(occurrence(d('2026-09-24'), 'weekly', n)))).toEqual([
      '2026-09-24',
      '2026-10-01',
      '2026-10-08',
      '2026-10-29',
    ])
  })

  it('clamps a monthly bill on the 31st to the end of shorter months and returns to the 31st', () => {
    const dates = Array.from({ length: 7 }, (_, n) => iso(occurrence(d('2026-01-31'), 'monthly', n)))

    expect(dates).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
    ])
  })

  it.each([
    ['2026-01-29', ['2026-01-29', '2026-02-28', '2026-03-29']],
    ['2026-01-30', ['2026-01-30', '2026-02-28', '2026-03-30']],
    ['2028-01-29', ['2028-01-29', '2028-02-29', '2028-03-29']],
    ['2028-01-31', ['2028-01-31', '2028-02-29', '2028-03-31']],
  ])('handles a monthly bill anchored on %s, including leap years', (anchor, expected) => {
    expect([0, 1, 2].map((n) => iso(occurrence(d(anchor), 'monthly', n)))).toEqual(expected)
  })

  it('never drifts: the 50th occurrence still lands on the anchor day when the month allows', () => {
    expect(iso(occurrence(d('2026-01-31'), 'monthly', 12))).toBe('2027-01-31')
    expect(iso(occurrence(d('2026-01-31'), 'monthly', 50))).toBe('2030-03-31')
  })

  it('rolls over the year end', () => {
    expect(iso(occurrence(d('2026-11-15'), 'monthly', 2))).toBe('2027-01-15')
    expect(iso(occurrence(d('2026-12-31'), 'monthly', 2))).toBe('2027-02-28')
  })

  it('repeats yearly and treats 29 February as the 28th in common years', () => {
    expect([0, 1, 2, 3, 4].map((n) => iso(occurrence(d('2028-02-29'), 'yearly', n)))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ])
    expect(iso(occurrence(d('2026-09-24'), 'yearly', 3))).toBe('2029-09-24')
  })
})

describe('firstOccurrenceOnOrAfter', () => {
  it('returns the anchor when the date is on or before it', () => {
    expect(iso(firstOccurrenceOnOrAfter(d('2026-10-15'), 'monthly', d('2026-09-01')))).toBe('2026-10-15')
    expect(iso(firstOccurrenceOnOrAfter(d('2026-10-15'), 'monthly', d('2026-10-15')))).toBe('2026-10-15')
  })

  it.each([
    ['2026-01-31', 'monthly', '2026-02-15', '2026-02-28'],
    ['2026-01-31', 'monthly', '2026-02-28', '2026-02-28'],
    ['2026-01-31', 'monthly', '2026-03-01', '2026-03-31'],
    ['2026-09-01', 'weekly', '2026-09-25', '2026-09-29'],
    ['2026-09-01', 'weekly', '2026-09-29', '2026-09-29'],
    ['2026-09-01', 'weekly', '2026-09-30', '2026-10-06'],
    ['2028-02-29', 'yearly', '2028-03-01', '2029-02-28'],
    ['2028-02-29', 'yearly', '2029-02-28', '2029-02-28'],
    ['2028-02-29', 'yearly', '2032-01-01', '2032-02-29'],
    ['2026-03-15', 'monthly', '2026-12-31', '2027-01-15'],
  ] as const)('%s %s, from %s, is next due %s', (anchor, recurrence, from, expected) => {
    expect(iso(firstOccurrenceOnOrAfter(d(anchor), recurrence, d(from)))).toBe(expected)
  })

  it('always returns the earliest occurrence that is not before the date', () => {
    const anchors = ['2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', '2028-02-29', '2026-12-31']
    for (const anchor of anchors) {
      for (const recurrence of ['weekly', 'monthly', 'yearly'] as const) {
        for (let offset = 0; offset < 800; offset += 13) {
          const from = new Date(d(anchor).getTime() + offset * 86_400_000)

          const result = firstOccurrenceOnOrAfter(d(anchor), recurrence, from)

          expect(result.getTime()).toBeGreaterThanOrEqual(from.getTime())
          const previous = [...Array(2000).keys()]
            .map((n) => occurrence(d(anchor), recurrence, n))
            .filter((date) => date.getTime() < result.getTime())
            .at(-1)
          if (previous) expect(previous.getTime()).toBeLessThan(from.getTime())
        }
      }
    }
  })

  it('is fast for a date decades after the anchor', () => {
    expect(iso(firstOccurrenceOnOrAfter(d('2000-01-31'), 'monthly', d('2099-06-01')))).toBe('2099-06-30')
    expect(iso(firstOccurrenceOnOrAfter(d('2000-01-01'), 'weekly', d('2099-06-01'))).length).toBe(10)
  })
})
```

Run: `cd backend && npx vitest run src/features/fixed-expenses/recurrence.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

`backend/src/features/fixed-expenses/fixed-expense.recurrence-types.ts`:

```ts
export const RECURRENCES = ['weekly', 'monthly', 'yearly'] as const

export type Recurrence = (typeof RECURRENCES)[number]
```

`backend/src/features/fixed-expenses/recurrence.ts`:

```ts
import { addDays } from '../../shared/dates/calendarDate.ts'
import type { Recurrence } from './fixed-expense.recurrence-types.ts'

const DAY_MS = 86_400_000

const daysInMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

/**
 * The n-th occurrence of a schedule (0 is the anchor). Every occurrence is derived from the
 * anchor, never from the previous occurrence, so a bill on the 31st goes 31 Jan, 28 Feb,
 * 31 Mar rather than drifting to the 28th for good.
 */
export function occurrence(anchor: Date, recurrence: Recurrence, n: number): Date {
  if (recurrence === 'weekly') return addDays(anchor, 7 * n)

  const monthsToAdd = recurrence === 'monthly' ? n : 12 * n
  const totalMonths = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + monthsToAdd
  const year = Math.floor(totalMonths / 12)
  const monthIndex = totalMonths % 12
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, monthIndex))
  return new Date(Date.UTC(year, monthIndex, day))
}

/** A starting guess that never overshoots, so the search below only walks forward a step or two. */
function estimate(anchor: Date, recurrence: Recurrence, date: Date): number {
  if (recurrence === 'weekly') return Math.floor((date.getTime() - anchor.getTime()) / (7 * DAY_MS))
  const months =
    (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (date.getUTCMonth() - anchor.getUTCMonth())
  return recurrence === 'monthly' ? months : Math.floor(months / 12)
}

/** The earliest occurrence that is not before `date`. */
export function firstOccurrenceOnOrAfter(anchor: Date, recurrence: Recurrence, date: Date): Date {
  if (date.getTime() <= anchor.getTime()) return anchor

  let n = Math.max(0, estimate(anchor, recurrence, date) - 1)
  while (occurrence(anchor, recurrence, n).getTime() < date.getTime()) n += 1
  return occurrence(anchor, recurrence, n)
}
```

Run: `npx vitest run src/features/fixed-expenses/recurrence.test.ts` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add drift-free recurrence maths" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Model, schemas, DTO and test helpers

**Files:**
- Create: `backend/src/features/fixed-expenses/fixed-expense.model.ts`, `fixed-expense.schemas.ts`, `fixed-expense.dto.ts`, `fixed-expense.test-helpers.ts`

**Interfaces:**
- Consumes: `Recurrence`, `RECURRENCES`.
- Produces: `FixedExpense` model, `type FixedExpenseAttrs`, `type FixedExpenseRecord` (lean shape with `_id`, `createdAt`, `updatedAt`); `createFixedExpenseSchema`, `updateFixedExpenseSchema`, `listFixedExpensesQuerySchema` with inferred types `CreateFixedExpenseInput`, `UpdateFixedExpenseInput`, `ListFixedExpensesQuery`; `FixedExpenseDto`, `toFixedExpenseDto`; test helper `insertFixedExpense(userId, overrides?)`.

- [ ] **Step 1: Write the model**

`backend/src/features/fixed-expenses/fixed-expense.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'
import { RECURRENCES, type Recurrence } from './fixed-expense.recurrence-types.ts'

export interface FixedExpenseAttrs {
  userId: Types.ObjectId
  name: string
  label: string
  /** Positive integer in the currency's minor unit. */
  amountMinor: number
  currency: string
  recurrence: Recurrence
  /** The date the schedule is based on (UTC midnight). Every occurrence derives from it. */
  anchorDate: Date
  /** The next occurrence on or after the day it was last computed (UTC midnight). */
  nextDueDate: Date
  /** Days before the due date to send the reminder, 0 to 30. */
  leadDays: number
  remindersEnabled: boolean
  active: boolean
  /** The due date the last reminder was sent for. Guarantees one email per occurrence. */
  lastRemindedFor?: Date
}

export type FixedExpenseRecord = FixedExpenseAttrs & {
  _id: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const fixedExpenseSchema = new Schema<FixedExpenseAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    label: { type: String, default: '', trim: true, maxlength: 40 },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      max: 1_000_000_000_000,
      validate: { validator: Number.isInteger, message: 'amountMinor must be an integer' },
    },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    recurrence: { type: String, enum: RECURRENCES, required: true },
    anchorDate: { type: Date, required: true },
    nextDueDate: { type: Date, required: true },
    leadDays: { type: Number, default: 3, min: 0, max: 30 },
    remindersEnabled: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    lastRemindedFor: { type: Date },
  },
  { timestamps: true },
)

fixedExpenseSchema.index({ userId: 1, nextDueDate: 1 })
// The reminder job scans across users by due date.
fixedExpenseSchema.index({ active: 1, nextDueDate: 1 })

export const FixedExpense = model<FixedExpenseAttrs>('FixedExpense', fixedExpenseSchema)
```

- [ ] **Step 2: Write the schemas**

`backend/src/features/fixed-expenses/fixed-expense.schemas.ts`:

```ts
import { z } from 'zod'
import { calendarDateSchema, paginationQuerySchema } from '../../shared/validation/requestSchemas.ts'
import { RECURRENCES } from './fixed-expense.recurrence-types.ts'

// The name goes into an email subject, so it must be a single line.
const singleLine = /^[^\r\n]*$/

const nameSchema = z.string().trim().min(1, 'Name is required').max(80).regex(singleLine, 'Use a single line')
const labelSchema = z.string().trim().max(40).regex(singleLine, 'Use a single line')
const anchorDateSchema = calendarDateSchema.refine(
  (value) => value >= '2000-01-01' && value <= '2100-12-31',
  'Choose a date between 2000 and 2100',
)

const fields = {
  name: nameSchema,
  label: labelSchema,
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  recurrence: z.enum(RECURRENCES),
  anchorDate: anchorDateSchema,
  leadDays: z.number().int().min(0).max(30),
  remindersEnabled: z.boolean(),
}

export const createFixedExpenseSchema = z.object({
  name: fields.name,
  label: fields.label.default(''),
  amountMinor: fields.amountMinor,
  recurrence: fields.recurrence,
  anchorDate: fields.anchorDate,
  leadDays: fields.leadDays.default(3),
  remindersEnabled: fields.remindersEnabled.default(true),
})

export const updateFixedExpenseSchema = z
  .object({ ...fields, active: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update')

export const listFixedExpensesQuerySchema = paginationQuerySchema.extend({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export type CreateFixedExpenseInput = z.infer<typeof createFixedExpenseSchema>
export type UpdateFixedExpenseInput = z.infer<typeof updateFixedExpenseSchema>
export type ListFixedExpensesQuery = z.infer<typeof listFixedExpensesQuerySchema>
```

- [ ] **Step 3: Write the DTO and the helper**

`backend/src/features/fixed-expenses/fixed-expense.dto.ts`:

```ts
import { formatCalendarDate } from '../../shared/dates/calendarDate.ts'
import type { FixedExpenseRecord } from './fixed-expense.model.ts'
import type { Recurrence } from './fixed-expense.recurrence-types.ts'

export interface FixedExpenseDto {
  id: string
  name: string
  label: string
  amountMinor: number
  currency: string
  recurrence: Recurrence
  anchorDate: string
  nextDueDate: string
  leadDays: number
  remindersEnabled: boolean
  active: boolean
}

export function toFixedExpenseDto(expense: FixedExpenseRecord): FixedExpenseDto {
  return {
    id: expense._id.toString(),
    name: expense.name,
    label: expense.label,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    recurrence: expense.recurrence,
    anchorDate: formatCalendarDate(expense.anchorDate),
    nextDueDate: formatCalendarDate(expense.nextDueDate),
    leadDays: expense.leadDays,
    remindersEnabled: expense.remindersEnabled,
    active: expense.active,
  }
}
```

`backend/src/features/fixed-expenses/fixed-expense.test-helpers.ts`:

```ts
import { Types } from 'mongoose'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import {
  FixedExpense,
  type FixedExpenseAttrs,
  type FixedExpenseRecord,
} from './fixed-expense.model.ts'

type Overrides = Partial<Omit<FixedExpenseAttrs, 'userId' | 'anchorDate' | 'nextDueDate' | 'lastRemindedFor'>> & {
  /** YYYY-MM-DD. Defaults to nextDueDate. */
  anchorDate?: string
  /** YYYY-MM-DD */
  nextDueDate?: string
  /** YYYY-MM-DD */
  lastRemindedFor?: string
}

/** Inserts straight into the database, bypassing the API (for arranging test state). */
export async function insertFixedExpense(
  userId: string,
  overrides: Overrides = {},
): Promise<FixedExpenseRecord> {
  const { anchorDate, nextDueDate = '2026-10-01', lastRemindedFor, ...rest } = overrides
  const expense = await FixedExpense.create({
    userId: new Types.ObjectId(userId),
    name: 'Rent',
    label: '',
    amountMinor: 125000,
    currency: 'USD',
    recurrence: 'monthly',
    leadDays: 3,
    remindersEnabled: true,
    active: true,
    ...rest,
    anchorDate: parseCalendarDate(anchorDate ?? nextDueDate),
    nextDueDate: parseCalendarDate(nextDueDate),
    lastRemindedFor: lastRemindedFor ? parseCalendarDate(lastRemindedFor) : undefined,
  })
  return expense.toObject<FixedExpenseRecord>()
}
```

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add model, request schemas, DTO and test helper" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: CRUD endpoints

**Files:**
- Create: `backend/src/features/fixed-expenses/fixed-expense.service.ts`, `fixed-expense.controller.ts`, `fixed-expense.routes.ts`, `index.ts`, `fixed-expense.crud.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `getUserProfile` from `../auth/index.ts`, `firstOccurrenceOnOrAfter`, `todayUtc`.
- Produces: `createFixedExpense(userId, input)`, `getFixedExpense(userId, id)`, `listFixedExpenses(userId, query): Promise<Paginated<FixedExpenseDto>>` (sorted by `nextDueDate`, soonest first), `updateFixedExpense(userId, id, input)`, `deleteFixedExpense(userId, id)`; routes `GET/POST /api/fixed-expenses`, `GET/PATCH/DELETE /api/fixed-expenses/:id`.

Scheduling rules the service enforces:

- On create, `nextDueDate` is the first occurrence on or after today (the anchor itself when it is today or later).
- Changing `anchorDate` or `recurrence` recomputes `nextDueDate` from today and clears `lastRemindedFor`, so the new schedule can send its own reminder.
- Resuming a paused bill (`active` false to true) recomputes `nextDueDate` from today but keeps `lastRemindedFor`, so an occurrence that was already reminded is not reminded again.
- Any other edit (amount, name, lead time, reminders switch) leaves the schedule alone.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/fixed-expenses/fixed-expense.crud.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { addDays, formatCalendarDate, todayUtc } from '../../shared/dates/calendarDate.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { FixedExpense } from './fixed-expense.model.ts'
import { insertFixedExpense } from './fixed-expense.test-helpers.ts'

const profiles = vi.hoisted(() => new Map<string, string>())
vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Ada',
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

/** The due date the last reminder was recorded for, as YYYY-MM-DD. */
async function remindedFor(id: string): Promise<string | undefined> {
  const stored = await FixedExpense.findById(id)
  return stored?.lastRemindedFor ? formatCalendarDate(stored.lastRemindedFor) : undefined
}

/** A calendar date this many days from today (UTC), so tests do not depend on the calendar. */
const day = (offset: number) => formatCalendarDate(addDays(todayUtc(), offset))

const create = (body: object, user = alice) =>
  request(app).post('/api/fixed-expenses').set(user.headers).send(body)
const list = (query = '', user = alice) =>
  request(app).get(`/api/fixed-expenses${query}`).set(user.headers)
const patch = (id: string, body: object) =>
  request(app).patch(`/api/fixed-expenses/${id}`).set(alice.headers).send(body)

const valid = (overrides: object = {}) => ({
  name: 'Rent',
  amountMinor: 125000,
  recurrence: 'monthly',
  anchorDate: day(10),
  ...overrides,
})

describe('POST /api/fixed-expenses', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/fixed-expenses').send(valid()).expect(401)
  })

  it('creates a bill with sensible defaults and the user\'s currency', async () => {
    profiles.set(alice.id, 'EUR')

    const res = await create(valid())

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      name: 'Rent',
      label: '',
      amountMinor: 125000,
      currency: 'EUR',
      recurrence: 'monthly',
      anchorDate: day(10),
      nextDueDate: day(10),
      leadDays: 3,
      remindersEnabled: true,
      active: true,
    })
  })

  it('is next due today when the anchor is today', async () => {
    expect((await create(valid({ anchorDate: day(0) }))).body.nextDueDate).toBe(day(0))
  })

  it('moves a past anchor forward to the next occurrence but keeps the anchor', async () => {
    const res = await create(valid({ recurrence: 'weekly', anchorDate: day(-10) }))

    expect(res.body.anchorDate).toBe(day(-10))
    expect(res.body.nextDueDate).toBe(day(4))
  })

  it('keeps a monthly bill on its anchor day when the anchor is long ago', async () => {
    const anchor = '2020-01-15'

    const res = await create(valid({ anchorDate: anchor }))

    expect(res.body.nextDueDate.slice(8)).toBe('15')
    expect(res.body.nextDueDate >= day(0)).toBe(true)
    expect(res.body.nextDueDate < day(32)).toBe(true)
  })

  it('accepts a lead time of 0 and 30 and a reminder switched off', async () => {
    expect((await create(valid({ leadDays: 0 }))).body.leadDays).toBe(0)
    expect((await create(valid({ leadDays: 30, remindersEnabled: false }))).body).toMatchObject({
      leadDays: 30,
      remindersEnabled: false,
    })
  })

  it.each([
    ['a blank name', { name: '  ' }],
    ['a name with a line break', { name: 'Rent\nBcc: x@example.com' }],
    ['a long name', { name: 'x'.repeat(81) }],
    ['a label with a line break', { label: 'a\nb' }],
    ['a zero amount', { amountMinor: 0 }],
    ['a fractional amount', { amountMinor: 12.5 }],
    ['an amount over the limit', { amountMinor: 1_000_000_000_001 }],
    ['an unknown recurrence', { recurrence: 'daily' }],
    ['an impossible date', { anchorDate: '2026-02-30' }],
    ['a date before 2000', { anchorDate: '1999-12-31' }],
    ['a date after 2100', { anchorDate: '2101-01-01' }],
    ['a lead time of 31', { leadDays: 31 }],
    ['a negative lead time', { leadDays: -1 }],
    ['a fractional lead time', { leadDays: 1.5 }],
  ])('rejects %s with 400 and stores nothing', async (_name, override) => {
    const res = await create(valid(override))

    expect(res.status).toBe(400)
    expect(await FixedExpense.countDocuments()).toBe(0)
  })

  it('ignores a client-supplied userId, currency, nextDueDate and active flag', async () => {
    const bob = testUser()

    const res = await create({
      ...valid(),
      userId: bob.id,
      currency: 'JPY',
      nextDueDate: '2001-01-01',
      active: false,
      lastRemindedFor: '2026-01-01',
    })

    const stored = await FixedExpense.findById(res.body.id)
    expect(stored?.userId.toString()).toBe(alice.id)
    expect(stored?.currency).toBe('USD')
    expect(stored?.active).toBe(true)
    expect(stored?.lastRemindedFor).toBeUndefined()
    expect(res.body.nextDueDate).toBe(day(10))
  })
})

describe('GET /api/fixed-expenses', () => {
  it('returns an empty page for a user with no bills', async () => {
    expect((await list()).body).toEqual({ items: [], page: 1, limit: 50, total: 0 })
  })

  it('lists soonest first, and filters by active', async () => {
    await insertFixedExpense(alice.id, { name: 'later', nextDueDate: day(20) })
    await insertFixedExpense(alice.id, { name: 'soon', nextDueDate: day(2) })
    await insertFixedExpense(alice.id, { name: 'paused', nextDueDate: day(1), active: false })

    const all = await list()
    const activeOnly = await list('?active=true')
    const pausedOnly = await list('?active=false')

    expect(all.body.items.map((e: { name: string }) => e.name)).toEqual(['paused', 'soon', 'later'])
    expect(activeOnly.body.items.map((e: { name: string }) => e.name)).toEqual(['soon', 'later'])
    expect(pausedOnly.body.items.map((e: { name: string }) => e.name)).toEqual(['paused'])
  })

  it('paginates and reports the total', async () => {
    for (let offset = 1; offset <= 5; offset += 1) {
      await insertFixedExpense(alice.id, { name: `b${offset}`, nextDueDate: day(offset) })
    }

    const res = await list('?limit=2&page=2')

    expect(res.body.items.map((e: { name: string }) => e.name)).toEqual(['b3', 'b4'])
    expect(res.body).toMatchObject({ page: 2, limit: 2, total: 5 })
  })

  it.each(['?page=0', '?limit=201', '?active=maybe'])('rejects %s', async (query) => {
    await list(query).expect(400)
  })
})

describe('GET /api/fixed-expenses/:id', () => {
  it('returns the bill, 404 for an unknown id, 400 for a malformed one', async () => {
    const bill = await insertFixedExpense(alice.id)

    const ok = await request(app).get(`/api/fixed-expenses/${bill._id.toString()}`).set(alice.headers)
    expect(ok.status).toBe(200)
    expect(ok.body.id).toBe(bill._id.toString())
    await request(app).get('/api/fixed-expenses/65f1c2a4b3d4e5f6a7b8c9d0').set(alice.headers).expect(404)
    await request(app).get('/api/fixed-expenses/nope').set(alice.headers).expect(400)
  })
})

describe('PATCH /api/fixed-expenses/:id', () => {
  it('changing only the amount, name, label, lead time or reminder switch leaves the schedule alone', async () => {
    const bill = await insertFixedExpense(alice.id, {
      nextDueDate: day(5),
      anchorDate: day(5),
      lastRemindedFor: day(5),
    })

    const res = await patch(bill._id.toString(), {
      amountMinor: 999,
      name: 'New name',
      label: 'home',
      leadDays: 7,
      remindersEnabled: false,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      amountMinor: 999,
      name: 'New name',
      label: 'home',
      leadDays: 7,
      remindersEnabled: false,
      nextDueDate: day(5),
    })
    expect(await remindedFor(bill._id.toString())).toBe(day(5))
  })

  it('changing the anchor date recomputes the next due date and allows a fresh reminder', async () => {
    const bill = await insertFixedExpense(alice.id, {
      nextDueDate: day(5),
      anchorDate: day(5),
      lastRemindedFor: day(5),
    })

    const res = await patch(bill._id.toString(), { anchorDate: day(20) })

    expect(res.body).toMatchObject({ anchorDate: day(20), nextDueDate: day(20) })
    expect(await remindedFor(bill._id.toString())).toBeUndefined()
  })

  it('changing the recurrence recomputes the next due date and allows a fresh reminder', async () => {
    const bill = await insertFixedExpense(alice.id, {
      recurrence: 'monthly',
      anchorDate: day(-10),
      nextDueDate: day(20),
      lastRemindedFor: day(20),
    })

    const res = await patch(bill._id.toString(), { recurrence: 'weekly' })

    expect(res.body.nextDueDate).toBe(day(4))
    expect(await remindedFor(bill._id.toString())).toBeUndefined()
  })

  it('pausing keeps the dates; resuming recomputes from today but keeps the reminder record', async () => {
    const bill = await insertFixedExpense(alice.id, {
      recurrence: 'weekly',
      anchorDate: day(-30),
      nextDueDate: day(-30),
      lastRemindedFor: day(-30),
      active: false,
    })

    const resumed = await patch(bill._id.toString(), { active: true })

    expect(resumed.body).toMatchObject({ active: true, nextDueDate: day(5) })
    expect(await remindedFor(bill._id.toString())).toBe(day(-30))

    const paused = await patch(bill._id.toString(), { active: false })
    expect(paused.body).toMatchObject({ active: false, nextDueDate: day(5) })
  })

  it('cannot change the currency, and rejects an empty or invalid update', async () => {
    const bill = await insertFixedExpense(alice.id, { currency: 'EUR' })

    const res = await patch(bill._id.toString(), { name: 'x', currency: 'JPY' })
    expect(res.body.currency).toBe('EUR')
    await patch(bill._id.toString(), {}).expect(400)
    await patch(bill._id.toString(), { leadDays: 31 }).expect(400)
    await patch('65f1c2a4b3d4e5f6a7b8c9d0', { name: 'x' }).expect(404)
  })
})

describe('DELETE /api/fixed-expenses/:id', () => {
  it('deletes with 204 and then answers 404', async () => {
    const bill = await insertFixedExpense(alice.id)

    await request(app).delete(`/api/fixed-expenses/${bill._id.toString()}`).set(alice.headers).expect(204)

    await request(app).delete(`/api/fixed-expenses/${bill._id.toString()}`).set(alice.headers).expect(404)
  })
})
```

Run: `npx vitest run src/features/fixed-expenses/fixed-expense.crud.test.ts` → FAIL (404 on the route).

- [ ] **Step 2: Implement the service**

`backend/src/features/fixed-expenses/fixed-expense.service.ts`:

```ts
import { Types, type QueryFilter } from 'mongoose'
import { parseCalendarDate, todayUtc } from '../../shared/dates/calendarDate.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { paginated, toSkip, type Paginated } from '../../shared/validation/requestSchemas.ts'
import { getUserProfile } from '../auth/index.ts'
import { toFixedExpenseDto, type FixedExpenseDto } from './fixed-expense.dto.ts'
import {
  FixedExpense,
  type FixedExpenseAttrs,
  type FixedExpenseRecord,
} from './fixed-expense.model.ts'
import type {
  CreateFixedExpenseInput,
  ListFixedExpensesQuery,
  UpdateFixedExpenseInput,
} from './fixed-expense.schemas.ts'
import { firstOccurrenceOnOrAfter } from './recurrence.ts'

export async function createFixedExpense(
  userId: string,
  input: CreateFixedExpenseInput,
): Promise<FixedExpenseDto> {
  const profile = await getUserProfile(userId)
  if (!profile) throw new AppError(401, 'Not authorized')

  const anchorDate = parseCalendarDate(input.anchorDate)
  const expense = await FixedExpense.create({
    userId: new Types.ObjectId(userId),
    name: input.name,
    label: input.label,
    amountMinor: input.amountMinor,
    currency: profile.currency,
    recurrence: input.recurrence,
    anchorDate,
    nextDueDate: firstOccurrenceOnOrAfter(anchorDate, input.recurrence, todayUtc()),
    leadDays: input.leadDays,
    remindersEnabled: input.remindersEnabled,
    active: true,
  })
  return toFixedExpenseDto(expense.toObject<FixedExpenseRecord>())
}

export async function getFixedExpense(userId: string, id: string): Promise<FixedExpenseDto> {
  const expense = await FixedExpense.findOne({ _id: id, userId: new Types.ObjectId(userId) }).lean<FixedExpenseRecord | null>()
  if (!expense) throw new AppError(404, 'Bill not found')
  return toFixedExpenseDto(expense)
}

export async function listFixedExpenses(
  userId: string,
  query: ListFixedExpensesQuery,
): Promise<Paginated<FixedExpenseDto>> {
  const filter: QueryFilter<FixedExpenseAttrs> = { userId: new Types.ObjectId(userId) }
  if (query.active !== undefined) filter.active = query.active

  const [items, total] = await Promise.all([
    FixedExpense.find(filter)
      .sort({ nextDueDate: 1, _id: 1 })
      .skip(toSkip(query))
      .limit(query.limit)
      .lean<FixedExpenseRecord[]>(),
    FixedExpense.countDocuments(filter),
  ])
  return paginated(items.map(toFixedExpenseDto), total, query)
}

export async function updateFixedExpense(
  userId: string,
  id: string,
  input: UpdateFixedExpenseInput,
): Promise<FixedExpenseDto> {
  const expense = await FixedExpense.findOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (!expense) throw new AppError(404, 'Bill not found')

  let scheduleChanged = false
  let resumed = false

  if (input.name !== undefined) expense.name = input.name
  if (input.label !== undefined) expense.label = input.label
  if (input.amountMinor !== undefined) expense.amountMinor = input.amountMinor
  if (input.leadDays !== undefined) expense.leadDays = input.leadDays
  if (input.remindersEnabled !== undefined) expense.remindersEnabled = input.remindersEnabled

  if (input.recurrence !== undefined && input.recurrence !== expense.recurrence) {
    expense.recurrence = input.recurrence
    scheduleChanged = true
  }
  if (input.anchorDate !== undefined) {
    const anchorDate = parseCalendarDate(input.anchorDate)
    if (anchorDate.getTime() !== expense.anchorDate.getTime()) {
      expense.anchorDate = anchorDate
      scheduleChanged = true
    }
  }
  if (input.active !== undefined) {
    resumed = input.active && !expense.active
    expense.active = input.active
  }

  if (scheduleChanged || resumed) {
    expense.nextDueDate = firstOccurrenceOnOrAfter(expense.anchorDate, expense.recurrence, todayUtc())
  }
  // A new schedule may remind for its first occurrence. A resumed bill keeps its record so an
  // occurrence that was already reminded is not reminded twice.
  if (scheduleChanged) expense.lastRemindedFor = undefined

  await expense.save()
  return toFixedExpenseDto(expense.toObject<FixedExpenseRecord>())
}

export async function deleteFixedExpense(userId: string, id: string): Promise<void> {
  const result = await FixedExpense.deleteOne({ _id: id, userId: new Types.ObjectId(userId) })
  if (result.deletedCount === 0) throw new AppError(404, 'Bill not found')
}
```

- [ ] **Step 3: Controller, routes and wiring**

`backend/src/features/fixed-expenses/fixed-expense.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type {
  CreateFixedExpenseInput,
  ListFixedExpensesQuery,
  UpdateFixedExpenseInput,
} from './fixed-expense.schemas.ts'
import * as fixedExpenseService from './fixed-expense.service.ts'

export async function list(req: Request, res: Response) {
  res.json(
    await fixedExpenseService.listFixedExpenses(authUserId(req), req.query as unknown as ListFixedExpensesQuery),
  )
}

export async function create(req: Request, res: Response) {
  res
    .status(201)
    .json(await fixedExpenseService.createFixedExpense(authUserId(req), req.body as CreateFixedExpenseInput))
}

export async function get(req: Request, res: Response) {
  res.json(await fixedExpenseService.getFixedExpense(authUserId(req), req.params.id as string))
}

export async function update(req: Request, res: Response) {
  res.json(
    await fixedExpenseService.updateFixedExpense(
      authUserId(req),
      req.params.id as string,
      req.body as UpdateFixedExpenseInput,
    ),
  )
}

export async function remove(req: Request, res: Response) {
  await fixedExpenseService.deleteFixedExpense(authUserId(req), req.params.id as string)
  res.status(204).end()
}
```

`backend/src/features/fixed-expenses/fixed-expense.routes.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { validate } from '../../shared/middleware/validate.ts'
import { idParamsSchema } from '../../shared/validation/requestSchemas.ts'
import { create, get, list, remove, update } from './fixed-expense.controller.ts'
import {
  createFixedExpenseSchema,
  listFixedExpensesQuerySchema,
  updateFixedExpenseSchema,
} from './fixed-expense.schemas.ts'

export const fixedExpenseRouter = Router()

fixedExpenseRouter.use(requireAuth)
fixedExpenseRouter.get('/', validate({ query: listFixedExpensesQuerySchema }), list)
fixedExpenseRouter.post('/', validate({ body: createFixedExpenseSchema }), create)
fixedExpenseRouter.get('/:id', validate({ params: idParamsSchema }), get)
fixedExpenseRouter.patch('/:id', validate({ params: idParamsSchema, body: updateFixedExpenseSchema }), update)
fixedExpenseRouter.delete('/:id', validate({ params: idParamsSchema }), remove)
```

`backend/src/features/fixed-expenses/index.ts`:

```ts
export { fixedExpenseRouter } from './fixed-expense.routes.ts'
```

In `backend/src/app.ts` add `import { fixedExpenseRouter } from './features/fixed-expenses/index.ts'` and mount it after the finance router: `app.use('/api/fixed-expenses', fixedExpenseRouter)`.

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add bill CRUD with schedule-aware updates" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Reminder email and server-side money formatting

**Files:**
- Create: `backend/src/features/fixed-expenses/money-format.ts`, `money-format.test.ts`, `reminder.email.ts`, `reminder.email.test.ts`

**Interfaces:**
- Consumes: `sendMail` from `../../shared/mailer/mailer.ts`, `env.CLIENT_URL`.
- Produces: `formatMoney(minor: number, currency: string): string` (display only); `sendReminderEmail(input: ReminderEmailInput): Promise<void>` where `ReminderEmailInput = { to: string; userName: string; expenseName: string; amountMinor: number; currency: string; dueDate: Date; daysUntil: number }`. Unlike the auth emails, **it throws when sending fails**, because the job must know.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/fixed-expenses/money-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney } from './money-format.ts'

describe('formatMoney', () => {
  it('formats minor units for display with the currency\'s own number of decimals', () => {
    expect(formatMoney(125000, 'USD')).toBe('$1,250.00')
    expect(formatMoney(5, 'USD')).toBe('$0.05')
    expect(formatMoney(500, 'JPY')).toBe('¥500')
    expect(formatMoney(1234, 'BHD')).toContain('1.234')
  })
})
```

`backend/src/features/fixed-expenses/reminder.email.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendMail } from '../../shared/mailer/mailer.ts'
import { parseCalendarDate } from '../../shared/dates/calendarDate.ts'
import { sendReminderEmail } from './reminder.email.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

const sendMailMock = vi.mocked(sendMail)

const base = {
  to: 'ada@example.com',
  userName: 'Ada',
  expenseName: 'Rent',
  amountMinor: 125000,
  currency: 'USD',
  dueDate: parseCalendarDate('2026-10-01'),
}

beforeEach(() => {
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
})

describe('sendReminderEmail', () => {
  it.each([
    [3, 'Reminder: Rent is due in 3 days'],
    [1, 'Reminder: Rent is due tomorrow'],
    [0, 'Reminder: Rent is due today'],
    [-2, 'Reminder: Rent was due on October 1, 2026'],
  ])('with %i days to go the subject is "%s"', async (daysUntil, subject) => {
    await sendReminderEmail({ ...base, daysUntil })

    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({ to: 'ada@example.com', subject })
  })

  it('names the bill, amount and date and links to the Bills page, and nothing else', async () => {
    await sendReminderEmail({ ...base, daysUntil: 3 })

    const text = sendMailMock.mock.calls[0]?.[0].text ?? ''
    expect(text).toContain('Hi Ada,')
    expect(text).toContain('Rent')
    expect(text).toContain('$1,250.00')
    expect(text).toContain('October 1, 2026')
    expect(text).toContain('http://localhost:5173/bills')
    expect(text).not.toMatch(/token=/)
  })

  it('throws when the mail cannot be sent, so the job can react', async () => {
    sendMailMock.mockRejectedValue(new Error('smtp down'))

    await expect(sendReminderEmail({ ...base, daysUntil: 3 })).rejects.toThrow('smtp down')
  })
})
```

Run → FAIL (modules missing).

- [ ] **Step 2: Implement**

`backend/src/features/fixed-expenses/money-format.ts`:

```ts
/** For emails only. The stored amount stays an integer; the division is display-only. */
export function formatMoney(minor: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(minor / 10 ** digits)
}
```

`backend/src/features/fixed-expenses/reminder.email.ts`:

```ts
import { env } from '../../shared/config/env.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'
import { formatMoney } from './money-format.ts'

export interface ReminderEmailInput {
  to: string
  userName: string
  expenseName: string
  amountMinor: number
  currency: string
  dueDate: Date
  /** Whole days from today to the due date. Negative when the date has passed. */
  daysUntil: number
}

const longDate = (date: Date) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)

function whenPhrase(daysUntil: number, due: string): string {
  if (daysUntil < 0) return `was due on ${due}`
  if (daysUntil === 0) return 'is due today'
  if (daysUntil === 1) return 'is due tomorrow'
  return `is due in ${daysUntil} days`
}

/** Throws if the mail cannot be sent: the reminder job must know, unlike the account emails. */
export async function sendReminderEmail(input: ReminderEmailInput): Promise<void> {
  const due = longDate(input.dueDate)
  const when = whenPhrase(input.daysUntil, due)
  const link = new URL('/bills', env.CLIENT_URL).toString()

  await sendMail({
    to: input.to,
    subject: `Reminder: ${input.expenseName} ${when}`,
    text: [
      `Hi ${input.userName},`,
      '',
      `${input.expenseName} (${formatMoney(input.amountMinor, input.currency)}) ${when}.`,
      '',
      `Due date: ${due}`,
      '',
      `Open your bills: ${link}`,
      '',
      'You are getting this because reminders are on for this bill. You can change that on the Bills page.',
    ].join('\n'),
  })
}
```

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add the reminder email and money formatting" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: The reminder job

**Files:**
- Create: `backend/src/features/fixed-expenses/reminder.service.ts`, `reminder.service.test.ts`

**Interfaces:**
- Consumes: `FixedExpense`, `firstOccurrenceOnOrAfter`, `sendReminderEmail`, `getUserProfile`, `todayUtc`, `addDays`.
- Produces: `runReminders(now?: Date): Promise<ReminderResult>` with `ReminderResult = { sent: number; skipped: number; advanced: number; failed: number }`.

Behaviour, per active bill due within 30 days of today (UTC):

1. **Remind** if reminders are on, today is on or after `nextDueDate - leadDays`, and this occurrence has not been reminded. The occurrence is *claimed* first with a conditional update (`lastRemindedFor` not equal to the due date). Only the run that wins the claim sends, so concurrent runs cannot double-send. If sending fails, the claim is released and the bill counts as `failed`. If the user no longer exists or the claim was lost, it counts as `skipped`.
2. **Advance** if `nextDueDate` is before today: set it to the first occurrence on or after today. A bill is advanced only when its reminder is settled (sent, already sent, switched off, or the user is gone), so a failed send is retried by the next run instead of being lost.

- [ ] **Step 1: Write the failing tests**

`backend/src/features/fixed-expenses/reminder.service.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatCalendarDate } from '../../shared/dates/calendarDate.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { FixedExpense } from './fixed-expense.model.ts'
import { insertFixedExpense } from './fixed-expense.test-helpers.ts'
import { runReminders } from './reminder.service.ts'

const profiles = vi.hoisted(
  () => new Map<string, { email: string; name: string; currency: string } | null>(),
)
vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) =>
    profiles.has(id)
      ? profiles.get(id)
      : { id, email: `${id}@example.com`, name: 'Ada', currency: 'USD' },
}))
vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

const sendMailMock = vi.mocked(sendMail)

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)
beforeEach(() => {
  profiles.clear()
  sendMailMock.mockReset()
  sendMailMock.mockResolvedValue(undefined)
})

const alice = testUser()
const bob = testUser()
/** The job runs at some time on this UTC day. */
const at = (date: string) => new Date(`${date}T09:30:00.000Z`)

const stored = async (id: string) => {
  const expense = await FixedExpense.findById(id)
  if (!expense) throw new Error('bill missing')
  return {
    nextDueDate: formatCalendarDate(expense.nextDueDate),
    lastRemindedFor: expense.lastRemindedFor ? formatCalendarDate(expense.lastRemindedFor) : undefined,
  }
}

describe('runReminders: when to remind', () => {
  it('sends one email when today is exactly the lead time before the due date', async () => {
    await insertFixedExpense(alice.id, { name: 'Rent', nextDueDate: '2026-10-01', leadDays: 3 })

    const result = await runReminders(at('2026-09-28'))

    expect(result).toEqual({ sent: 1, skipped: 0, advanced: 0, failed: 0 })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({
      to: `${alice.id}@example.com`,
      subject: 'Reminder: Rent is due in 3 days',
    })
  })

  it('sends nothing before the lead time', async () => {
    await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 3 })

    const result = await runReminders(at('2026-09-27'))

    expect(result).toEqual({ sent: 0, skipped: 0, advanced: 0, failed: 0 })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('a lead time of 0 reminds only on the due day', async () => {
    await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 0 })

    expect((await runReminders(at('2026-09-30'))).sent).toBe(0)
    expect((await runReminders(at('2026-10-01'))).sent).toBe(1)
    expect(sendMailMock.mock.calls[0]?.[0].subject).toMatch(/is due today/)
  })

  it('a lead time of 30 reminds a month ahead', async () => {
    await insertFixedExpense(alice.id, { nextDueDate: '2026-10-31', leadDays: 30 })

    expect((await runReminders(at('2026-10-01'))).sent).toBe(1)
  })

  it('skips paused bills and bills with reminders switched off', async () => {
    await insertFixedExpense(alice.id, { name: 'paused', nextDueDate: '2026-10-01', active: false })
    await insertFixedExpense(alice.id, { name: 'quiet', nextDueDate: '2026-10-01', remindersEnabled: false })

    const result = await runReminders(at('2026-09-30'))

    expect(result).toEqual({ sent: 0, skipped: 0, advanced: 0, failed: 0 })
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

describe('runReminders: at most one email per occurrence', () => {
  it('does not email again on a second run the same day, or the next days before the due date', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 3 })

    await runReminders(at('2026-09-28'))
    const second = await runReminders(at('2026-09-28'))
    const later = await runReminders(at('2026-09-30'))

    expect(second).toEqual({ sent: 0, skipped: 1, advanced: 0, failed: 0 })
    expect(later.sent).toBe(0)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect((await stored(bill._id.toString())).lastRemindedFor).toBe('2026-10-01')
  })

  it('sends only one email when two runs overlap', async () => {
    await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 3 })

    const results = await Promise.all([runReminders(at('2026-09-28')), runReminders(at('2026-09-28'))])

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1)
  })

  it('reminds again for the next occurrence', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 3 })
    await runReminders(at('2026-09-28'))
    await runReminders(at('2026-10-02'))
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-11-01')

    const result = await runReminders(at('2026-10-29'))

    expect(result.sent).toBe(1)
    expect(sendMailMock).toHaveBeenCalledTimes(2)
    expect((await stored(bill._id.toString())).lastRemindedFor).toBe('2026-11-01')
  })
})

describe('runReminders: rolling the due date forward', () => {
  it('keeps a bill due today where it is, then advances it the day after', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', leadDays: 3 })

    const onTheDay = await runReminders(at('2026-10-01'))
    expect(onTheDay.advanced).toBe(0)
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-10-01')

    const dayAfter = await runReminders(at('2026-10-02'))
    expect(dayAfter).toEqual({ sent: 0, skipped: 1, advanced: 1, failed: 0 })
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-11-01')
  })

  it('a bill missed for days gets exactly one email, then jumps to the next occurrence', async () => {
    const bill = await insertFixedExpense(alice.id, {
      nextDueDate: '2026-09-20',
      anchorDate: '2026-09-20',
      leadDays: 3,
    })

    const result = await runReminders(at('2026-09-25'))

    expect(result).toEqual({ sent: 1, skipped: 0, advanced: 1, failed: 0 })
    expect(sendMailMock.mock.calls[0]?.[0].subject).toBe('Reminder: Rent was due on September 20, 2026')
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-10-20')
  })

  it('a weekly bill missed for weeks lands on the right weekday', async () => {
    const bill = await insertFixedExpense(alice.id, {
      recurrence: 'weekly',
      anchorDate: '2026-09-01',
      nextDueDate: '2026-09-01',
    })

    await runReminders(at('2026-09-25'))

    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-09-29')
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('advances a month-end bill to the last day of the next month, then back to the 31st', async () => {
    const bill = await insertFixedExpense(alice.id, {
      anchorDate: '2026-01-31',
      nextDueDate: '2026-01-31',
      remindersEnabled: false,
    })

    await runReminders(at('2026-02-01'))
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-02-28')

    await runReminders(at('2026-03-01'))
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-03-31')
  })

  it('advances a bill whose reminders are off, without emailing', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01', remindersEnabled: false })

    const result = await runReminders(at('2026-10-05'))

    expect(result).toEqual({ sent: 0, skipped: 0, advanced: 1, failed: 0 })
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-11-01')
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('does not advance or touch a paused bill', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-09-01', active: false })

    await runReminders(at('2026-10-05'))

    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-09-01')
  })
})

describe('runReminders: when sending fails', () => {
  it('releases the claim, counts a failure, keeps an overdue bill where it is, and retries next time', async () => {
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-09-20', leadDays: 3 })
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'))

    const first = await runReminders(at('2026-09-25'))

    expect(first).toEqual({ sent: 0, skipped: 0, advanced: 0, failed: 1 })
    expect(await stored(bill._id.toString())).toEqual({ nextDueDate: '2026-09-20', lastRemindedFor: undefined })

    const retry = await runReminders(at('2026-09-26'))

    expect(retry).toEqual({ sent: 1, skipped: 0, advanced: 1, failed: 0 })
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-10-20')
  })

  it('one failure does not stop the other bills', async () => {
    await insertFixedExpense(alice.id, { name: 'A', nextDueDate: '2026-10-01' })
    await insertFixedExpense(bob.id, { name: 'B', nextDueDate: '2026-10-01' })
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'))

    const result = await runReminders(at('2026-09-29'))

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(1)
  })
})

describe('runReminders: users', () => {
  it('emails each user only about their own bills, with their own currency', async () => {
    profiles.set(bob.id, { email: 'bob@example.com', name: 'Bob', currency: 'JPY' })
    await insertFixedExpense(alice.id, { name: 'Alice rent', amountMinor: 125000, nextDueDate: '2026-10-01' })
    await insertFixedExpense(bob.id, { name: 'Bob gym', amountMinor: 8000, currency: 'JPY', nextDueDate: '2026-10-01' })

    await runReminders(at('2026-09-30'))

    const sent = sendMailMock.mock.calls.map(([mail]) => mail)
    const toAlice = sent.find((mail) => mail.to === `${alice.id}@example.com`)
    const toBob = sent.find((mail) => mail.to === 'bob@example.com')
    expect(toAlice?.text).toContain('Alice rent')
    expect(toAlice?.text).toContain('$1,250.00')
    expect(toAlice?.text).not.toContain('Bob')
    expect(toBob?.text).toContain('Bob gym')
    expect(toBob?.text).toContain('¥8,000')
    expect(toBob?.text).not.toContain('Alice')
  })

  it('skips a bill whose owner no longer exists, and still advances it when overdue', async () => {
    profiles.set(alice.id, null)
    const bill = await insertFixedExpense(alice.id, { nextDueDate: '2026-09-20' })

    const result = await runReminders(at('2026-09-25'))

    expect(result).toEqual({ sent: 0, skipped: 1, advanced: 1, failed: 0 })
    expect(sendMailMock).not.toHaveBeenCalled()
    expect((await stored(bill._id.toString())).nextDueDate).toBe('2026-10-20')
  })
})

describe('runReminders: state written by the job', () => {
  it('writes only to the bill it is working on', async () => {
    const mine = await insertFixedExpense(alice.id, { nextDueDate: '2026-10-01' })
    const others = await insertFixedExpense(bob.id, { nextDueDate: '2027-06-01', anchorDate: '2027-06-01' })

    await runReminders(at('2026-09-30'))

    expect((await stored(mine._id.toString())).lastRemindedFor).toBe('2026-10-01')
    expect(await stored(others._id.toString())).toEqual({ nextDueDate: '2027-06-01', lastRemindedFor: undefined })
  })
})
```

Run: `npx vitest run src/features/fixed-expenses/reminder.service.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the job**

`backend/src/features/fixed-expenses/reminder.service.ts`:

```ts
import type { Types } from 'mongoose'
import { addDays, todayUtc } from '../../shared/dates/calendarDate.ts'
import { logger } from '../../shared/logger/logger.ts'
import { getUserProfile } from '../auth/index.ts'
import { FixedExpense, type FixedExpenseRecord } from './fixed-expense.model.ts'
import { firstOccurrenceOnOrAfter } from './recurrence.ts'
import { sendReminderEmail } from './reminder.email.ts'

export interface ReminderResult {
  sent: number
  skipped: number
  advanced: number
  failed: number
}

const DAY_MS = 86_400_000
/** The largest lead time a bill can have. */
const MAX_LEAD_DAYS = 30
const BATCH_SIZE = 200

type Outcome = 'sent' | 'skipped' | 'failed'

/**
 * Claims this occurrence, then emails. The conditional update means only one of several
 * concurrent runs can win, so an occurrence is never emailed twice.
 */
async function remind(expense: FixedExpenseRecord, today: Date): Promise<Outcome> {
  const claim = await FixedExpense.updateOne(
    { _id: expense._id, userId: expense.userId, lastRemindedFor: { $ne: expense.nextDueDate } },
    { $set: { lastRemindedFor: expense.nextDueDate } },
  )
  if (claim.modifiedCount !== 1) return 'skipped'

  /** Puts the record back as it was, so the next run can try again. */
  const release = () =>
    expense.lastRemindedFor
      ? FixedExpense.updateOne(
          { _id: expense._id, userId: expense.userId },
          { $set: { lastRemindedFor: expense.lastRemindedFor } },
        )
      : FixedExpense.updateOne(
          { _id: expense._id, userId: expense.userId },
          { $unset: { lastRemindedFor: '' } },
        )

  const profile = await getUserProfile(expense.userId.toString())
  if (!profile) {
    await release()
    return 'skipped'
  }

  try {
    await sendReminderEmail({
      to: profile.email,
      userName: profile.name,
      expenseName: expense.name,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      dueDate: expense.nextDueDate,
      daysUntil: Math.round((expense.nextDueDate.getTime() - today.getTime()) / DAY_MS),
    })
    return 'sent'
  } catch (err) {
    await release()
    logger.error({ err, expenseId: expense._id.toString() }, 'Reminder email failed')
    return 'failed'
  }
}

async function processExpense(expense: FixedExpenseRecord, today: Date, result: ReminderResult) {
  const remindFrom = addDays(expense.nextDueDate, -expense.leadDays)
  const alreadyReminded = expense.lastRemindedFor?.getTime() === expense.nextDueDate.getTime()

  let outcome: Outcome | null = null
  if (expense.remindersEnabled && today.getTime() >= remindFrom.getTime()) {
    outcome = alreadyReminded ? 'skipped' : await remind(expense, today)
    if (outcome === 'sent') result.sent += 1
    else if (outcome === 'failed') result.failed += 1
    else result.skipped += 1
  }

  // Move an overdue bill on, but not while its reminder still needs another attempt.
  if (expense.nextDueDate.getTime() < today.getTime() && outcome !== 'failed') {
    const next = firstOccurrenceOnOrAfter(expense.anchorDate, expense.recurrence, today)
    const moved = await FixedExpense.updateOne(
      { _id: expense._id, userId: expense.userId, nextDueDate: expense.nextDueDate },
      { $set: { nextDueDate: next } },
    )
    if (moved.modifiedCount === 1) result.advanced += 1
  }
}

/**
 * The daily job. It is the one place that reads across users, so it is reached only through the
 * cron-secret endpoint, and every write it makes is filtered by the bill's own _id and userId.
 *
 * Safe to retry and to run concurrently. After missed days it sends one email per bill and
 * moves the due date to the next occurrence on or after today.
 */
export async function runReminders(now: Date = new Date()): Promise<ReminderResult> {
  const today = todayUtc(now)
  const result: ReminderResult = { sent: 0, skipped: 0, advanced: 0, failed: 0 }
  const horizon = addDays(today, MAX_LEAD_DAYS)

  // Walk the bills in _id order, a batch at a time. Paging by _id is unaffected by the updates
  // made along the way (which change nextDueDate, not _id).
  let after: Types.ObjectId | undefined
  for (;;) {
    const batch = await FixedExpense.find({
      active: true,
      nextDueDate: { $lte: horizon },
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean<FixedExpenseRecord[]>()

    for (const expense of batch) await processExpense(expense, today, result)

    const last = batch.at(-1)
    if (!last || batch.length < BATCH_SIZE) break
    after = last._id
  }
  return result
}
```

Run: `npx vitest run src/features/fixed-expenses/reminder.service.test.ts` → PASS. If the concurrent-runs test flakes, the cause is a claim that is not conditional; re-check that the `updateOne` filter contains `lastRemindedFor: { $ne: ... }`.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add the idempotent reminder job" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: The internal endpoint and the scheduled workflow

**Files:**
- Create: `backend/src/features/fixed-expenses/reminder.controller.ts`, `reminder.routes.ts`, `reminder.routes.test.ts`, `.github/workflows/reminders.yml`
- Modify: `backend/src/features/fixed-expenses/index.ts`, `backend/src/app.ts`

**Interfaces:**
- Produces: `reminderRouter` (mounted at `/api/internal/reminders`): `POST /run` behind `internalRateLimiter` and `requireCronSecret`, answering `200 { sent, skipped, advanced, failed }`.

- [ ] **Step 1: Write the failing test**

`backend/src/features/fixed-expenses/reminder.routes.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { env } from '../../shared/config/env.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { testUser } from '../../test/auth.ts'
import { insertFixedExpense } from './fixed-expense.test-helpers.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'

vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({ id, email: `${id}@example.com`, name: 'Ada', currency: 'USD' }),
}))
vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const run = () => request(app).post('/api/internal/reminders/run')

describe('POST /api/internal/reminders/run', () => {
  it.each([
    ['no secret', undefined],
    ['a wrong secret', 'x'.repeat(env.CRON_SECRET.length)],
    ['an empty secret', ''],
  ])('rejects %s with 401 and does nothing', async (_name, secret) => {
    await insertFixedExpense(testUser().id, { nextDueDate: '2999-01-01' })

    const res = await (secret === undefined ? run() : run().set('x-cron-secret', secret))

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ message: 'Not authorized' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects a normal user token: users cannot trigger the job', async () => {
    const res = await run().set(testUser().headers)

    expect(res.status).toBe(401)
  })

  it('runs the job with the right secret and returns only counts', async () => {
    const res = await run().set('x-cron-secret', env.CRON_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: 0, skipped: 0, advanced: 0, failed: 0 })
  })

  it('does not answer to GET', async () => {
    await request(app).get('/api/internal/reminders/run').set('x-cron-secret', env.CRON_SECRET).expect(404)
  })
})
```

Run → FAIL (404 for the route).

- [ ] **Step 2: Implement**

`backend/src/features/fixed-expenses/reminder.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { runReminders } from './reminder.service.ts'

/** Responds with counts only: nothing about any user. */
export async function run(_req: Request, res: Response) {
  res.json(await runReminders())
}
```

`backend/src/features/fixed-expenses/reminder.routes.ts`:

```ts
import { Router } from 'express'
import { internalRateLimiter } from '../../shared/middleware/rateLimiters.ts'
import { requireCronSecret } from '../../shared/middleware/requireCronSecret.ts'
import { run } from './reminder.controller.ts'

export const reminderRouter = Router()

reminderRouter.post('/run', internalRateLimiter, requireCronSecret, run)
```

Replace `backend/src/features/fixed-expenses/index.ts`:

```ts
export { fixedExpenseRouter } from './fixed-expense.routes.ts'
export { reminderRouter } from './reminder.routes.ts'
```

In `backend/src/app.ts` extend the import to `import { fixedExpenseRouter, reminderRouter } from './features/fixed-expenses/index.ts'` and mount below the bills router:

```ts
app.use('/api/internal/reminders', reminderRouter)
```

Run: `npx vitest run src/features/fixed-expenses/reminder.routes.test.ts` → PASS.

- [ ] **Step 3: Add the scheduled workflow**

`.github/workflows/reminders.yml` (at the repository root):

```yaml
name: Send fixed-expense reminders

on:
  schedule:
    # 01:17 UTC every day. Not on the hour: GitHub delays runs at the start of every hour.
    - cron: '17 1 * * *'
  workflow_dispatch:

permissions: {}

jobs:
  remind:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Call the reminder endpoint
        env:
          BACKEND_URL: ${{ secrets.BACKEND_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          # The backend may be asleep on Render's free tier and take about a minute to wake, so
          # retry every 30 seconds for a few minutes. The job is idempotent, so retries are safe.
          curl --fail-with-body --silent --show-error \
            --retry 8 --retry-delay 30 --retry-all-errors \
            --max-time 120 \
            --request POST \
            --header "x-cron-secret: ${CRON_SECRET}" \
            "${BACKEND_URL}/api/internal/reminders/run"
```

The workflow calls the Render URL directly, not the Netlify proxy, so the proxy's 26-second limit does not apply. The `BACKEND_URL` and `CRON_SECRET` repository secrets are created in M6. Manual runs are possible from the Actions tab (`workflow_dispatch`).

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend .github
git commit -m "feat(fixed-expenses): add the protected reminder endpoint and daily workflow" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Tenant isolation and the slice's public API

**Files:**
- Create: `backend/src/features/fixed-expenses/fixed-expense.data.ts`, `fixed-expense.isolation.test.ts`, `fixed-expense.public-api.test.ts`
- Modify: `backend/src/features/fixed-expenses/index.ts`

**Interfaces:**
- Produces (from `features/fixed-expenses/index.ts`): `fixedExpenseRouter`, `reminderRouter`, `type FixedExpenseDto`, `exportFixedExpensesForUser(userId): Promise<FixedExpenseDto[]>`, `deleteFixedExpensesForUser(userId): Promise<void>`, `hasFixedExpensesForUser(userId): Promise<boolean>`.

- [ ] **Step 1: Write the isolation test (NFR-1)**

`backend/src/features/fixed-expenses/fixed-expense.isolation.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { FixedExpense } from './fixed-expense.model.ts'
import { insertFixedExpense } from './fixed-expense.test-helpers.ts'

vi.mock('../auth/index.ts', () => ({
  getUserProfile: async (id: string) => ({ id, email: `${id}@example.com`, name: 'Ada', currency: 'USD' }),
}))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const alice = testUser()
const bob = testUser()
let aliceBill: string

beforeEach(async () => {
  aliceBill = (await insertFixedExpense(alice.id, { name: 'alice secret', nextDueDate: '2999-01-01' }))._id.toString()
})

const asBob = {
  get: (url: string) => request(app).get(url).set(bob.headers),
  patch: (url: string, body: object) => request(app).patch(url).set(bob.headers).send(body),
  delete: (url: string) => request(app).delete(url).set(bob.headers),
  post: (url: string, body: object) => request(app).post(url).set(bob.headers).send(body),
}

describe("another user's bills look like they do not exist", () => {
  it('cannot be read, changed or deleted by id', async () => {
    await asBob.get(`/api/fixed-expenses/${aliceBill}`).expect(404)
    await asBob.patch(`/api/fixed-expenses/${aliceBill}`, { name: 'hacked', active: false }).expect(404)
    await asBob.delete(`/api/fixed-expenses/${aliceBill}`).expect(404)

    expect(await FixedExpense.findById(aliceBill)).toMatchObject({ name: 'alice secret', active: true })
  })

  it('never show up in lists, filtered or not', async () => {
    const all = await asBob.get('/api/fixed-expenses')
    const active = await asBob.get('/api/fixed-expenses?active=true')

    expect(all.body.total).toBe(0)
    expect(active.body.total).toBe(0)
  })

  it('cannot be created for someone else by sending their user id', async () => {
    const res = await asBob.post('/api/fixed-expenses', {
      name: 'planted',
      amountMinor: 100,
      recurrence: 'monthly',
      anchorDate: '2999-01-01',
      userId: alice.id,
    })

    expect((await FixedExpense.findById(res.body.id))?.userId.toString()).toBe(bob.id)
    expect(await FixedExpense.countDocuments({ userId: alice.id })).toBe(1)
  })

  it('keeps counts and pagination per user', async () => {
    await insertFixedExpense(bob.id, { name: 'bob only' })

    expect((await asBob.get('/api/fixed-expenses')).body.total).toBe(1)
    expect((await request(app).get('/api/fixed-expenses').set(alice.headers)).body.total).toBe(1)
  })
})
```

Run it. It should already PASS, because the service scopes every query by `userId`. If an assertion fails, that is a tenant leak: fix the service, never the test.

- [ ] **Step 2: Write the public API test**

`backend/src/features/fixed-expenses/fixed-expense.public-api.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { testUser } from '../../test/auth.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { FixedExpense } from './fixed-expense.model.ts'
import { insertFixedExpense } from './fixed-expense.test-helpers.ts'
import {
  deleteFixedExpensesForUser,
  exportFixedExpensesForUser,
  hasFixedExpensesForUser,
} from './index.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('fixed-expenses public API', () => {
  it('reports whether a user has any bills', async () => {
    const alice = testUser()
    const bob = testUser()
    await insertFixedExpense(bob.id)

    expect(await hasFixedExpensesForUser(alice.id)).toBe(false)
    expect(await hasFixedExpensesForUser(bob.id)).toBe(true)
  })

  it("exports only the user's own bills, soonest first", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertFixedExpense(alice.id, { name: 'later', nextDueDate: '2026-12-01' })
    await insertFixedExpense(alice.id, { name: 'sooner', nextDueDate: '2026-10-01' })
    await insertFixedExpense(bob.id, { name: 'not yours' })

    const exported = await exportFixedExpensesForUser(alice.id)

    expect(exported.map((bill) => bill.name)).toEqual(['sooner', 'later'])
    expect(exported[0]).toMatchObject({ nextDueDate: '2026-10-01', currency: 'USD', recurrence: 'monthly' })
  })

  it("deletes all of one user's bills and leaves everyone else's", async () => {
    const alice = testUser()
    const bob = testUser()
    await insertFixedExpense(alice.id)
    await insertFixedExpense(alice.id)
    await insertFixedExpense(bob.id)

    await deleteFixedExpensesForUser(alice.id)

    expect(await FixedExpense.countDocuments({ userId: alice.id })).toBe(0)
    expect(await FixedExpense.countDocuments({ userId: bob.id })).toBe(1)
  })
})
```

- [ ] **Step 3: Implement and export**

`backend/src/features/fixed-expenses/fixed-expense.data.ts`:

```ts
import { Types } from 'mongoose'
import { toFixedExpenseDto, type FixedExpenseDto } from './fixed-expense.dto.ts'
import { FixedExpense, type FixedExpenseRecord } from './fixed-expense.model.ts'

/** For the account export: every bill, soonest first. */
export async function exportFixedExpenses(userId: string): Promise<FixedExpenseDto[]> {
  const bills = await FixedExpense.find({ userId: new Types.ObjectId(userId) })
    .sort({ nextDueDate: 1, _id: 1 })
    .lean<FixedExpenseRecord[]>()
  return bills.map(toFixedExpenseDto)
}

export async function deleteAllFixedExpenses(userId: string): Promise<void> {
  await FixedExpense.deleteMany({ userId: new Types.ObjectId(userId) })
}

export async function hasFixedExpenses(userId: string): Promise<boolean> {
  return (await FixedExpense.exists({ userId: new Types.ObjectId(userId) })) !== null
}
```

Replace `backend/src/features/fixed-expenses/index.ts`:

```ts
export {
  deleteAllFixedExpenses as deleteFixedExpensesForUser,
  exportFixedExpenses as exportFixedExpensesForUser,
  hasFixedExpenses as hasFixedExpensesForUser,
} from './fixed-expense.data.ts'
export { fixedExpenseRouter } from './fixed-expense.routes.ts'
export { reminderRouter } from './reminder.routes.ts'
export type { FixedExpenseDto } from './fixed-expense.dto.ts'
```

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(fixed-expenses): add tenant isolation tests and the slice public API" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B: Frontend

All commands in Part B run from `frontend/`. Imports use `@/`; imports inside `features/fixed-expenses` are relative. Components that need the user's currency use `useSessionUser` from `@/features/auth`; their tests replace that module with `vi.mock('@/features/auth', ...)`.

### Task 8: Types, API, hooks, due-label and form logic

**Files:**
- Create under `frontend/src/features/fixed-expenses/`: `types.ts`, `api/billApi.ts`, `api/billKeys.ts`, `api/hooks.ts`, `api/hooks.test.tsx`, `dueLabel.ts`, `dueLabel.test.ts`, `billForm.ts`, `billForm.test.ts`

**Interfaces:**
- Produces: `Recurrence`, `RECURRENCES`, `RECURRENCE_LABELS`, `Bill`, `BillPage`, `BillInput`; API `listBills(params)`, `createBill(input)`, `updateBill(id, input)`, `deleteBill(id)`; `billKeys` (`all`, `list(params)`, `upcoming(limit)`); hooks `useBills(params?)`, `useUpcomingBills(limit = 3)`, `useCreateBill()`, `useUpdateBill()`, `useDeleteBill()`; `dueLabel(nextDueDate: string, today: string): { text: string; tone: 'overdue' | 'today' | 'soon' | 'later' }`; `makeBillFormSchema(currency)`, `type BillFormValues`, `toBillInput(values, currency)`, `toFormValues(currency, bill?, today?)`, `reminderText(bill): string`.

- [ ] **Step 0: Create the branch** (skip if already on `feature/fixed-expenses-reminders`)

```bash
git switch main && git switch -c feature/fixed-expenses-reminders
```

- [ ] **Step 1: Write types, API and keys**

`frontend/src/features/fixed-expenses/types.ts`:

```ts
export const RECURRENCES = ['weekly', 'monthly', 'yearly'] as const

export type Recurrence = (typeof RECURRENCES)[number]

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
}

export interface Bill {
  id: string
  name: string
  label: string
  amountMinor: number
  currency: string
  recurrence: Recurrence
  /** YYYY-MM-DD: the date the schedule is based on. */
  anchorDate: string
  /** YYYY-MM-DD */
  nextDueDate: string
  leadDays: number
  remindersEnabled: boolean
  active: boolean
}

export interface BillPage {
  items: Bill[]
  page: number
  limit: number
  total: number
}

export interface BillInput {
  name: string
  label: string
  amountMinor: number
  recurrence: Recurrence
  anchorDate: string
  leadDays: number
  remindersEnabled: boolean
}
```

`frontend/src/features/fixed-expenses/api/billApi.ts`:

```ts
import { httpClient } from '@/shared/api/httpClient'
import type { Bill, BillInput, BillPage } from '../types'

export interface ListBillsParams {
  active?: boolean
  page?: number
  limit?: number
}

export async function listBills(params: ListBillsParams = {}): Promise<BillPage> {
  const { data } = await httpClient.get<BillPage>('/fixed-expenses', { params })
  return data
}

export async function createBill(input: BillInput): Promise<Bill> {
  const { data } = await httpClient.post<Bill>('/fixed-expenses', input)
  return data
}

export async function updateBill(
  id: string,
  input: Partial<BillInput> & { active?: boolean },
): Promise<Bill> {
  const { data } = await httpClient.patch<Bill>(`/fixed-expenses/${id}`, input)
  return data
}

export async function deleteBill(id: string): Promise<void> {
  await httpClient.delete(`/fixed-expenses/${id}`)
}
```

`frontend/src/features/fixed-expenses/api/billKeys.ts`:

```ts
import type { ListBillsParams } from './billApi'

export const billKeys = {
  all: ['bills'] as const,
  list: (params: ListBillsParams) => ['bills', 'list', params] as const,
  upcoming: (limit: number) => ['bills', 'upcoming', limit] as const,
}
```

- [ ] **Step 2: Write the failing hook tests**

`frontend/src/features/fixed-expenses/api/hooks.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as billApi from './billApi'
import { useBills, useCreateBill, useUpcomingBills } from './hooks'
import { billKeys } from './billKeys'

vi.mock('./billApi')

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(billApi.listBills).mockResolvedValue({ items: [], page: 1, limit: 50, total: 0 })
})

describe('bill hooks', () => {
  it('useBills asks for everything, soonest first, in one big page', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => useBills(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(billApi.listBills).mock.calls[0]?.[0]).toEqual({ limit: 200 })
  })

  it('useUpcomingBills asks for the next few active bills', async () => {
    const { wrapper } = setup()

    const { result } = renderHook(() => useUpcomingBills(3), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(billApi.listBills).mock.calls[0]?.[0]).toEqual({ active: true, limit: 3 })
  })

  it('creating a bill refreshes every bill list', async () => {
    vi.mocked(billApi.createBill).mockResolvedValue({
      id: '1',
      name: 'Rent',
      label: '',
      amountMinor: 100,
      currency: 'USD',
      recurrence: 'monthly',
      anchorDate: '2026-10-01',
      nextDueDate: '2026-10-01',
      leadDays: 3,
      remindersEnabled: true,
      active: true,
    })
    const { client, wrapper } = setup()
    client.setQueryData(billKeys.upcoming(3), { items: [] })
    const { result } = renderHook(() => useCreateBill(), { wrapper })

    result.current.mutate({
      name: 'Rent',
      label: '',
      amountMinor: 100,
      recurrence: 'monthly',
      anchorDate: '2026-10-01',
      leadDays: 3,
      remindersEnabled: true,
    })

    await waitFor(() => expect(client.getQueryState(billKeys.upcoming(3))?.isInvalidated).toBe(true))
  })
})
```

Run: `npx vitest run src/features/fixed-expenses/api` → FAIL (`./hooks` missing).

- [ ] **Step 3: Implement the hooks**

`frontend/src/features/fixed-expenses/api/hooks.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBill, deleteBill, listBills, updateBill, type ListBillsParams } from './billApi'
import { billKeys } from './billKeys'

/** Every bill, soonest first. A person has a handful, so one page of 200 is enough. */
export function useBills() {
  const params: ListBillsParams = { limit: 200 }
  return useQuery({ queryKey: billKeys.list(params), queryFn: () => listBills(params) })
}

/** The next few active bills, soonest first. For the dashboard. */
export function useUpcomingBills(limit = 3) {
  return useQuery({
    queryKey: billKeys.upcoming(limit),
    queryFn: () => listBills({ active: true, limit }),
  })
}

function useInvalidateBills() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: billKeys.all })
}

export function useCreateBill() {
  return useMutation({ mutationFn: createBill, onSuccess: useInvalidateBills() })
}

export function useUpdateBill() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateBill>[1] }) =>
      updateBill(id, input),
    onSuccess: useInvalidateBills(),
  })
}

export function useDeleteBill() {
  return useMutation({ mutationFn: deleteBill, onSuccess: useInvalidateBills() })
}
```

Run → PASS.

- [ ] **Step 4: Write and implement the due label**

`frontend/src/features/fixed-expenses/dueLabel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dueLabel } from './dueLabel'

describe('dueLabel', () => {
  const today = '2026-09-24'

  it.each([
    ['2026-09-24', 'Due today', 'today'],
    ['2026-09-25', 'Due tomorrow', 'soon'],
    ['2026-09-27', 'Due in 3 days', 'soon'],
    ['2026-10-01', 'Due in 7 days', 'soon'],
    ['2026-10-02', 'Due in 8 days', 'later'],
    ['2026-12-31', 'Due in 98 days', 'later'],
    ['2026-09-23', 'Overdue by 1 day', 'overdue'],
    ['2026-09-20', 'Overdue by 4 days', 'overdue'],
  ] as const)('%s reads "%s"', (due, text, tone) => {
    expect(dueLabel(due, today)).toEqual({ text, tone })
  })

  it('counts whole days across a month and year end', () => {
    expect(dueLabel('2027-01-02', '2026-12-31').text).toBe('Due in 2 days')
    expect(dueLabel('2026-12-31', '2027-01-02').text).toBe('Overdue by 2 days')
  })
})
```

`frontend/src/features/fixed-expenses/dueLabel.ts`:

```ts
import { daysBetween } from '@/shared/lib/dates'

export interface DueLabel {
  text: string
  tone: 'overdue' | 'today' | 'soon' | 'later'
}

const plural = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`

/** How to describe a due date to a person. Both dates are YYYY-MM-DD. */
export function dueLabel(nextDueDate: string, today: string): DueLabel {
  const days = daysBetween(today, nextDueDate)
  if (days < 0) return { text: `Overdue by ${plural(-days)}`, tone: 'overdue' }
  if (days === 0) return { text: 'Due today', tone: 'today' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' }
  return { text: `Due in ${plural(days)}`, tone: days <= 7 ? 'soon' : 'later' }
}
```

Run: `npx vitest run src/features/fixed-expenses/dueLabel.test.ts` → PASS.

- [ ] **Step 5: Write and implement the form logic**

`frontend/src/features/fixed-expenses/billForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { makeBillFormSchema, reminderText, toBillInput, toFormValues } from './billForm'
import type { Bill } from './types'

const valid = {
  name: 'Rent',
  label: 'home',
  amount: '1250.00',
  recurrence: 'monthly',
  anchorDate: '2026-10-01',
  leadDays: '3',
  remindersEnabled: true,
  paused: false,
} as const

describe('makeBillFormSchema', () => {
  const usd = makeBillFormSchema('USD')

  it('accepts a valid bill', () => {
    expect(usd.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['a blank name', { name: '  ' }, 'Enter a name'],
    ['a long name', { name: 'x'.repeat(81) }, 'Use at most 80 characters'],
    ['a long label', { label: 'x'.repeat(41) }, 'Use at most 40 characters'],
    ['an empty amount', { amount: '' }, 'Enter an amount'],
    ['a zero amount', { amount: '0' }, 'Amount must be greater than zero'],
    ['text for an amount', { amount: 'abc' }, 'Enter a valid amount in USD'],
    ['too many decimals', { amount: '1.234' }, 'Enter a valid amount in USD'],
    ['no date', { anchorDate: '' }, 'Choose a date'],
    ['a date before 2000', { anchorDate: '1999-12-31' }, 'Choose a date between 2000 and 2100'],
    ['a lead time of 31', { leadDays: '31' }, 'Use a whole number from 0 to 30'],
    ['a negative lead time', { leadDays: '-1' }, 'Use a whole number from 0 to 30'],
    ['a fractional lead time', { leadDays: '1.5' }, 'Use a whole number from 0 to 30'],
    ['an empty lead time', { leadDays: '' }, 'Use a whole number from 0 to 30'],
  ])('rejects %s', (_name, override, message) => {
    const result = usd.safeParse({ ...valid, ...override })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toContain(message)
  })

  it('uses the currency to decide the decimals', () => {
    expect(makeBillFormSchema('JPY').safeParse({ ...valid, amount: '900' }).success).toBe(true)
    expect(makeBillFormSchema('JPY').safeParse({ ...valid, amount: '9.5' }).success).toBe(false)
  })
})

describe('toBillInput', () => {
  it('converts the amount to minor units and the lead time to a number', () => {
    expect(toBillInput(valid, 'USD')).toEqual({
      name: 'Rent',
      label: 'home',
      amountMinor: 125000,
      recurrence: 'monthly',
      anchorDate: '2026-10-01',
      leadDays: 3,
      remindersEnabled: true,
    })
    expect(toBillInput({ ...valid, amount: '900' }, 'JPY').amountMinor).toBe(900)
  })

  it('trims text fields', () => {
    const input = toBillInput({ ...valid, name: '  Rent ', label: ' home ' }, 'USD')

    expect(input.name).toBe('Rent')
    expect(input.label).toBe('home')
  })
})

describe('toFormValues', () => {
  it('starts a new monthly bill dated today with a 3-day reminder', () => {
    expect(toFormValues('USD', undefined, '2026-09-24')).toEqual({
      name: '',
      label: '',
      amount: '',
      recurrence: 'monthly',
      anchorDate: '2026-09-24',
      leadDays: '3',
      remindersEnabled: true,
      paused: false,
    })
  })

  it('fills the form from a bill using the schedule date, not the next due date', () => {
    const bill: Bill = {
      id: '1',
      name: 'Rent',
      label: 'home',
      amountMinor: 125000,
      currency: 'USD',
      recurrence: 'monthly',
      anchorDate: '2026-01-31',
      nextDueDate: '2026-02-28',
      leadDays: 5,
      remindersEnabled: false,
      active: false,
    }

    expect(toFormValues('USD', bill)).toEqual({
      name: 'Rent',
      label: 'home',
      amount: '1250.00',
      recurrence: 'monthly',
      anchorDate: '2026-01-31',
      leadDays: '5',
      remindersEnabled: false,
      paused: true,
    })
  })
})

describe('reminderText', () => {
  const bill = { remindersEnabled: true, leadDays: 3 }

  it('describes the reminder', () => {
    expect(reminderText(bill)).toBe('3 days before')
    expect(reminderText({ ...bill, leadDays: 1 })).toBe('1 day before')
    expect(reminderText({ ...bill, leadDays: 0 })).toBe('On the day')
    expect(reminderText({ ...bill, remindersEnabled: false })).toBe('Off')
  })
})
```

Run → FAIL. Implement `frontend/src/features/fixed-expenses/billForm.ts`:

```ts
import { z } from 'zod'
import { todayIso } from '@/shared/lib/dates'
import { formatMinorForInput, toMinorUnits } from '@/shared/lib/money'
import { RECURRENCES, type Bill, type BillInput } from './types'

const MAX_MINOR = 1_000_000_000_000

export function makeBillFormSchema(currency: string) {
  return z.object({
    name: z.string().trim().min(1, 'Enter a name').max(80, 'Use at most 80 characters'),
    label: z.string().trim().max(40, 'Use at most 40 characters'),
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
    recurrence: z.enum(RECURRENCES),
    anchorDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
      .refine((value) => value >= '2000-01-01' && value <= '2100-12-31', 'Choose a date between 2000 and 2100'),
    leadDays: z.string().regex(/^(?:[0-9]|[12][0-9]|30)$/, 'Use a whole number from 0 to 30'),
    remindersEnabled: z.boolean(),
    paused: z.boolean(),
  })
}

export type BillFormValues = z.infer<ReturnType<typeof makeBillFormSchema>>

export function toBillInput(values: BillFormValues, currency: string): BillInput {
  return {
    name: values.name.trim(),
    label: values.label.trim(),
    amountMinor: toMinorUnits(values.amount, currency) ?? 0,
    recurrence: values.recurrence,
    anchorDate: values.anchorDate,
    leadDays: Number(values.leadDays),
    remindersEnabled: values.remindersEnabled,
  }
}

/**
 * The form edits the schedule's base date, not the next due date: a bill on the 31st has a next
 * due date of 28 February, and saving that would silently move the bill to the 28th for good.
 */
export function toFormValues(currency: string, bill?: Bill, today: string = todayIso()): BillFormValues {
  if (!bill) {
    return {
      name: '',
      label: '',
      amount: '',
      recurrence: 'monthly',
      anchorDate: today,
      leadDays: '3',
      remindersEnabled: true,
      paused: false,
    }
  }
  return {
    name: bill.name,
    label: bill.label,
    amount: formatMinorForInput(bill.amountMinor, currency),
    recurrence: bill.recurrence,
    anchorDate: bill.anchorDate,
    leadDays: String(bill.leadDays),
    remindersEnabled: bill.remindersEnabled,
    paused: !bill.active,
  }
}

export function reminderText(bill: Pick<Bill, 'remindersEnabled' | 'leadDays'>): string {
  if (!bill.remindersEnabled) return 'Off'
  if (bill.leadDays === 0) return 'On the day'
  return `${bill.leadDays} ${bill.leadDays === 1 ? 'day' : 'days'} before`
}
```

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 6: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(fixed-expenses): add bill types, API, hooks, due labels and form logic" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Bill form modal

**Files:**
- Create: `frontend/src/features/fixed-expenses/components/BillFormModal.tsx`, `BillFormModal.test.tsx`, `frontend/src/features/fixed-expenses/bills.css`

**Interfaces:**
- Produces: `BillFormModal({ mode, onClose })` with `mode: { kind: 'create' } | { kind: 'edit'; bill: Bill }` (exported type `BillFormMode`). In edit mode it also has a "Paused" checkbox and a two-step delete.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/fixed-expenses/components/BillFormModal.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as billApi from '../api/billApi'
import type { Bill } from '../types'
import { BillFormModal } from './BillFormModal'

const session = vi.hoisted(() => ({ currency: 'USD' }))
vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: session.currency }),
}))
vi.mock('../api/billApi')

const existing: Bill = {
  id: 'b1',
  name: 'Rent',
  label: 'home',
  amountMinor: 125000,
  currency: 'USD',
  recurrence: 'monthly',
  anchorDate: '2026-01-31',
  nextDueDate: '2026-02-28',
  leadDays: 3,
  remindersEnabled: true,
  active: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  session.currency = 'USD'
})

describe('BillFormModal (create)', () => {
  it('validates before calling the API', async () => {
    renderWithProviders(<BillFormModal mode={{ kind: 'create' }} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))

    expect(await screen.findByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount')).toBeInTheDocument()
    expect(billApi.createBill).not.toHaveBeenCalled()
  })

  it('creates a bill with the amount in minor units and the lead time as a number, then closes', async () => {
    vi.mocked(billApi.createBill).mockResolvedValue(existing)
    const onClose = vi.fn()
    renderWithProviders(<BillFormModal mode={{ kind: 'create' }} onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('Name'), 'Netflix')
    await userEvent.type(screen.getByLabelText(/^amount/i), '15.99')
    await userEvent.selectOptions(screen.getByLabelText(/^repeats/i), 'yearly')
    await userEvent.clear(screen.getByLabelText(/^remind me/i))
    await userEvent.type(screen.getByLabelText(/^remind me/i), '7')
    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(billApi.createBill).mock.calls[0]?.[0]).toMatchObject({
      name: 'Netflix',
      amountMinor: 1599,
      recurrence: 'yearly',
      leadDays: 7,
      remindersEnabled: true,
      label: '',
    })
  })

  it('rejects a lead time outside 0 to 30', async () => {
    renderWithProviders(<BillFormModal mode={{ kind: 'create' }} onClose={() => {}} />)
    await userEvent.type(screen.getByLabelText('Name'), 'x')
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')
    await userEvent.clear(screen.getByLabelText(/^remind me/i))
    await userEvent.type(screen.getByLabelText(/^remind me/i), '31')

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))

    expect(await screen.findByText('Use a whole number from 0 to 30')).toBeInTheDocument()
    expect(billApi.createBill).not.toHaveBeenCalled()
  })

  it('takes whole yen for JPY and rejects decimals', async () => {
    session.currency = 'JPY'
    renderWithProviders(<BillFormModal mode={{ kind: 'create' }} onClose={() => {}} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Gym')
    await userEvent.type(screen.getByLabelText(/^amount/i), '5.5')

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))

    expect(await screen.findByText('Enter a valid amount in JPY')).toBeInTheDocument()
  })

  it('keeps the dialog open and shows the server message when creation fails', async () => {
    vi.mocked(billApi.createBill).mockRejectedValue(new Error('Network Error'))
    const onClose = vi.fn()
    renderWithProviders(<BillFormModal mode={{ kind: 'create' }} onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Name'), 'x')
    await userEvent.type(screen.getByLabelText(/^amount/i), '5')

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))

    expect(await screen.findByText('Network Error')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BillFormModal (edit)', () => {
  it('fills the form from the bill, shows the next due date, and saves through update including the paused flag', async () => {
    vi.mocked(billApi.updateBill).mockResolvedValue(existing)
    const onClose = vi.fn()
    renderWithProviders(<BillFormModal mode={{ kind: 'edit', bill: existing }} onClose={onClose} />)

    expect(screen.getByLabelText(/^amount/i)).toHaveValue('1250.00')
    expect(screen.getByLabelText(/^first due date/i)).toHaveValue('2026-01-31')
    expect(screen.getByText(/next due/i)).toHaveTextContent('Feb 28, 2026')
    await userEvent.click(screen.getByLabelText('Paused'))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(billApi.updateBill).mock.calls[0]).toEqual([
      'b1',
      {
        name: 'Rent',
        label: 'home',
        amountMinor: 125000,
        recurrence: 'monthly',
        anchorDate: '2026-01-31',
        leadDays: 3,
        remindersEnabled: true,
        active: false,
      },
    ])
  })

  it('asks for confirmation before deleting', async () => {
    vi.mocked(billApi.deleteBill).mockResolvedValue()
    const onClose = vi.fn()
    renderWithProviders(<BillFormModal mode={{ kind: 'edit', bill: existing }} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete bill' }))
    expect(billApi.deleteBill).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(vi.mocked(billApi.deleteBill).mock.calls[0]?.[0]).toBe('b1')
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the modal**

`frontend/src/features/fixed-expenses/components/BillFormModal.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useSessionUser } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { formatDate } from '@/shared/lib/dates'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { pushToast } from '@/shared/ui/toast'
import { useCreateBill, useDeleteBill, useUpdateBill } from '../api/hooks'
import { makeBillFormSchema, toBillInput, toFormValues, type BillFormValues } from '../billForm'
import { RECURRENCE_LABELS, RECURRENCES, type Bill } from '../types'
import '../bills.css'

export type BillFormMode = { kind: 'create' } | { kind: 'edit'; bill: Bill }

interface BillFormModalProps {
  mode: BillFormMode
  onClose: () => void
}

export function BillFormModal({ mode, onClose }: BillFormModalProps) {
  const currency = useSessionUser()?.currency ?? 'USD'
  const editing = mode.kind === 'edit'
  const createBill = useCreateBill()
  const updateBill = useUpdateBill()
  const deleteBill = useDeleteBill()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const schema = useMemo(() => makeBillFormSchema(currency), [currency])
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BillFormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(currency, mode.kind === 'edit' ? mode.bill : undefined),
  })

  const failure = createBill.error ?? updateBill.error ?? deleteBill.error
  const saving = createBill.isPending || updateBill.isPending

  function onSubmit(values: BillFormValues) {
    const input = toBillInput(values, currency)
    if (mode.kind === 'edit') {
      updateBill.mutate(
        { id: mode.bill.id, input: { ...input, active: !values.paused } },
        {
          onSuccess: () => {
            pushToast('Bill saved', 'success')
            onClose()
          },
        },
      )
    } else {
      createBill.mutate(input, { onSuccess: onClose })
    }
  }

  function onDelete() {
    if (mode.kind !== 'edit') return
    deleteBill.mutate(mode.bill.id, {
      onSuccess: () => {
        pushToast('Bill deleted', 'success')
        onClose()
      },
    })
  }

  return (
    <Modal title={editing ? 'Edit bill' : 'Add bill'} onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Name" error={errors.name?.message}>
          <input {...register('name')} />
        </FormField>
        <FormField label="Label (optional)" error={errors.label?.message} hint="For example: home, work, subscriptions">
          <input {...register('label')} />
        </FormField>
        <FormField label={`Amount (${currency})`} error={errors.amount?.message}>
          <input inputMode="decimal" autoComplete="off" {...register('amount')} />
        </FormField>
        <div className="form-row">
          <FormField label="Repeats">
            <select {...register('recurrence')}>
              {RECURRENCES.map((value) => (
                <option key={value} value={value}>
                  {RECURRENCE_LABELS[value]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="First due date"
            error={errors.anchorDate?.message}
            hint="Later dates repeat from this one. A bill on the 31st is due on the last day of shorter months."
          >
            <input type="date" {...register('anchorDate')} />
          </FormField>
        </div>
        {mode.kind === 'edit' && (
          <p className="muted">Next due: {formatDate(mode.bill.nextDueDate)}</p>
        )}
        <FormField label="Remind me (days before)" error={errors.leadDays?.message} hint="0 to 30. Use 0 to be reminded on the day.">
          <input inputMode="numeric" {...register('leadDays')} />
        </FormField>
        <label className="check">
          <input type="checkbox" {...register('remindersEnabled')} />
          Send me reminder emails for this bill
        </label>
        {editing && (
          <label className="check">
            <input type="checkbox" {...register('paused')} />
            Paused
          </label>
        )}

        {failure && <p className="form-error">{getErrorMessage(failure)}</p>}

        <div className="form-actions">
          {mode.kind === 'edit' &&
            (confirmingDelete ? (
              <>
                <Button variant="danger" onClick={onDelete} loading={deleteBill.isPending}>
                  Yes, delete
                </Button>
                <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete bill
              </Button>
            ))}
          <Button type="submit" variant="primary" loading={saving}>
            {editing ? 'Save changes' : 'Add bill'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
```

The form field is `paused` (a bill's `active` flag inverted) so the checkbox reads naturally and nothing is inverted implicitly; the update call sends `active: !values.paused`.

The tests find fields with regular expressions where the label wraps a select or the hint would otherwise interfere: `getByLabelText(/^repeats/i)`, `/^amount/i`, `/^first due date/i`, `/^remind me/i`. `getByLabelText('Name')` matches exactly because only the `Name` field has that label text.

Create `frontend/src/features/fixed-expenses/bills.css`:

```css
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
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
.check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.bills {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.bills__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.bills__header h1 {
  margin: 0;
}
.bills-table {
  width: 100%;
  border-collapse: collapse;
}
.bills-table th,
.bills-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.bills-table__amount {
  text-align: right;
  white-space: nowrap;
}
.bills-table .is-paused {
  opacity: 0.6;
}
.due--overdue {
  color: var(--danger);
  font-weight: 600;
}
.due--today,
.due--soon {
  color: var(--warning);
}
.due--later {
  color: var(--text-muted);
}
.chip {
  display: inline-block;
  padding: 0 var(--space-2);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--accent);
  font-size: 0.75rem;
  line-height: 1.6;
}
```

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(fixed-expenses): add the bill form dialog" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: The Bills page, routes and navigation

**Files:**
- Create: `frontend/src/features/fixed-expenses/pages/BillsPage.tsx`, `pages/BillsPage.test.tsx`, `routes.ts`, `index.ts`
- Modify: `frontend/src/app/navigation.ts`, `frontend/src/app/router.ts`

**Interfaces:**
- Produces (from `@/features/fixed-expenses`): `billRoutes: RouteObject[]` (path `bills`), `useUpcomingBills`.

- [ ] **Step 1: Write the failing page tests**

`frontend/src/features/fixed-expenses/pages/BillsPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysIso, todayIso } from '@/shared/lib/dates'
import { renderWithProviders } from '@/test/render'
import * as billApi from '../api/billApi'
import type { Bill } from '../types'
import BillsPage from './BillsPage'

vi.mock('@/features/auth', () => ({
  useSessionUser: () => ({ id: '1', email: 'a@b.c', name: 'Ada', currency: 'USD' }),
}))
vi.mock('../api/billApi')

const inDays = (days: number) => addDaysIso(todayIso(), days)

function bill(id: string, overrides: Partial<Bill> = {}): Bill {
  return {
    id,
    name: `Bill ${id}`,
    label: '',
    amountMinor: 125000,
    currency: 'USD',
    recurrence: 'monthly',
    anchorDate: inDays(3),
    nextDueDate: inDays(3),
    leadDays: 3,
    remindersEnabled: true,
    active: true,
    ...overrides,
  }
}

const page = (items: Bill[], total = items.length) => ({ items, page: 1, limit: 200, total })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('BillsPage', () => {
  it('lists bills with amount, repeat, next due and reminder', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(
      page([
        bill('1', { name: 'Rent', label: 'home', nextDueDate: inDays(2) }),
        bill('2', { name: 'Netflix', amountMinor: 1599, recurrence: 'yearly', leadDays: 0, nextDueDate: inDays(40) }),
      ]),
    )

    renderWithProviders(<BillsPage />)

    const rows = await screen.findAllByRole('row')
    const rent = rows[1] as HTMLElement
    expect(within(rent).getByText('Rent')).toBeInTheDocument()
    expect(within(rent).getByText('home')).toBeInTheDocument()
    expect(within(rent).getByText('$1,250.00')).toBeInTheDocument()
    expect(within(rent).getByText('Every month')).toBeInTheDocument()
    expect(within(rent).getByText('Due in 2 days')).toBeInTheDocument()
    expect(within(rent).getByText('3 days before')).toBeInTheDocument()
    const netflix = rows[2] as HTMLElement
    expect(within(netflix).getByText('$15.99')).toBeInTheDocument()
    expect(within(netflix).getByText('Every year')).toBeInTheDocument()
    expect(within(netflix).getByText('On the day')).toBeInTheDocument()
  })

  it('marks overdue, due-today and paused bills in words, not only colour', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(
      page([
        bill('1', { name: 'Late', nextDueDate: inDays(-2) }),
        bill('2', { name: 'Today', nextDueDate: inDays(0) }),
        bill('3', { name: 'Stopped', active: false, remindersEnabled: false }),
      ]),
    )

    renderWithProviders(<BillsPage />)

    expect(await screen.findByText('Overdue by 2 days')).toBeInTheDocument()
    expect(screen.getByText('Due today')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('shows an empty state that invites the first bill', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(page([]))

    renderWithProviders(<BillsPage />)

    expect(await screen.findByText('No bills yet')).toBeInTheDocument()
  })

  it('shows loading, then an error with a retry', async () => {
    vi.mocked(billApi.listBills).mockRejectedValueOnce(new Error('boom'))
    vi.mocked(billApi.listBills).mockResolvedValue(page([bill('1', { name: 'Rent' })]))

    renderWithProviders(<BillsPage />)
    expect(screen.getByRole('status')).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Rent')).toBeInTheDocument()
  })

  it('warns when there are more bills than fit on the page', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(page([bill('1')], 250))

    renderWithProviders(<BillsPage />)

    expect(await screen.findByText(/showing the first 1 of 250 bills/i)).toBeInTheDocument()
  })

  it('opens the add dialog and creates a bill', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(page([]))
    vi.mocked(billApi.createBill).mockResolvedValue(bill('9'))
    renderWithProviders(<BillsPage />)
    await screen.findByText('No bills yet')

    await userEvent.click(screen.getByRole('button', { name: 'Add bill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Internet')
    await userEvent.type(screen.getByLabelText(/^amount/i), '60')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add bill' }))

    await vi.waitFor(() => expect(billApi.createBill).toHaveBeenCalled())
    expect(vi.mocked(billApi.createBill).mock.calls[0]?.[0]).toMatchObject({ name: 'Internet', amountMinor: 6000 })
  })

  it('opens a bill for editing', async () => {
    vi.mocked(billApi.listBills).mockResolvedValue(page([bill('1', { name: 'Rent' })]))
    renderWithProviders(<BillsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Rent' }))

    expect(screen.getByRole('dialog', { name: 'Edit bill' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Rent')
  })
})
```

Run: `npx vitest run src/features/fixed-expenses/pages` → FAIL (module missing).

- [ ] **Step 2: Implement the page, routes and API**

`frontend/src/features/fixed-expenses/pages/BillsPage.tsx`:

```tsx
import { useState } from 'react'
import { formatDate, todayIso } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import { useBills } from '../api/hooks'
import { reminderText } from '../billForm'
import { BillFormModal, type BillFormMode } from '../components/BillFormModal'
import { dueLabel } from '../dueLabel'
import { RECURRENCE_LABELS } from '../types'
import '../bills.css'

export default function BillsPage() {
  const query = useBills()
  const [modal, setModal] = useState<BillFormMode | null>(null)
  const today = todayIso()

  return (
    <div className="bills">
      <div className="bills__header">
        <h1>Bills</h1>
        <Button variant="primary" onClick={() => setModal({ kind: 'create' })}>
          Add bill
        </Button>
      </div>

      <Card>
        {query.isPending && <LoadingState label="Loading bills…" />}
        {query.isError && <ErrorState message="Could not load your bills" onRetry={() => query.refetch()} />}

        {query.isSuccess && query.data.items.length === 0 && (
          <EmptyState
            title="No bills yet"
            description="Add rent, subscriptions and other regular payments and we will email you before they are due."
            action={<Button onClick={() => setModal({ kind: 'create' })}>Add your first bill</Button>}
          />
        )}

        {query.isSuccess && query.data.items.length > 0 && (
          <>
            <table className="bills-table">
              <thead>
                <tr>
                  <th scope="col">Bill</th>
                  <th scope="col" className="bills-table__amount">
                    Amount
                  </th>
                  <th scope="col">Repeats</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Reminder</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((bill) => {
                  const label = dueLabel(bill.nextDueDate, today)
                  return (
                    <tr key={bill.id} className={bill.active ? '' : 'is-paused'}>
                      <td>
                        <strong>{bill.name}</strong>
                        {bill.label && <span className="chip">{bill.label}</span>}
                        {!bill.active && <span className="chip">Paused</span>}
                      </td>
                      <td className="bills-table__amount">{formatMinorUnits(bill.amountMinor, bill.currency)}</td>
                      <td>{RECURRENCE_LABELS[bill.recurrence]}</td>
                      <td>
                        <div>{formatDate(bill.nextDueDate)}</div>
                        {bill.active && <div className={`due--${label.tone}`}>{label.text}</div>}
                      </td>
                      <td>{reminderText(bill)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          aria-label={`Edit ${bill.name}`}
                          onClick={() => setModal({ kind: 'edit', bill })}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {query.data.total > query.data.items.length && (
              <p className="muted">
                Showing the first {query.data.items.length} of {query.data.total} bills.
              </p>
            )}
          </>
        )}
      </Card>

      {modal && <BillFormModal mode={modal} onClose={() => setModal(null)} />}
    </div>
  )
}
```

`frontend/src/features/fixed-expenses/routes.ts`:

```ts
import type { RouteObject } from 'react-router'

export const billRoutes: RouteObject[] = [
  {
    path: 'bills',
    lazy: async () => ({ Component: (await import('./pages/BillsPage')).default }),
  },
]
```

`frontend/src/features/fixed-expenses/index.ts`:

```ts
export { useUpcomingBills } from './api/hooks'
export { billRoutes } from './routes'
```

In `frontend/src/app/navigation.ts` add `{ to: '/bills', label: 'Bills' }` after Finance. In `frontend/src/app/router.ts` add `import { billRoutes } from '@/features/fixed-expenses'` and change the shell's children to `[...dashboardRoutes, ...taskRoutes, ...financeRoutes, ...billRoutes]`.

Run: `npx vitest run src/features/fixed-expenses` → PASS.

- [ ] **Step 3: Run all checks**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(fixed-expenses): add the Bills page with due labels and navigation" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Real-browser and real-email check, and milestone wrap-up

Emails and scheduling can only be proven end to end by hand. Setup: see M1 Task 13 (MongoDB, Mailpit on 1025, `.env` with `CRON_SECRET`).

- [ ] **Step 1: Walk the flows**

| Do this | Expect |
|---|---|
| Open **Bills** with no data | "No bills yet" with an add button |
| Add "Rent", 1250.00, monthly, first due date in 2 days, remind 3 days before | Row appears: next due in 2 days |
| Add "Gym", 30, weekly, first due date 20 days ago | Next due is the right weekday within the next 7 days, the anchor is unchanged when you edit it |
| Add a bill anchored on the 31st of a 30-day month | Later occurrences fall on the last day of shorter months and the 31st otherwise (check the next-due date after editing) |
| Edit Rent: change only the amount | Next due date unchanged |
| Edit Rent: change the first due date | Next due date follows |
| Pause a bill, then resume it | Paused chip and no due label; on resume the date is recomputed from today |
| Delete a bill (confirm) | It disappears |
| Run the job by hand: `curl -X POST -H "x-cron-secret: <CRON_SECRET>" http://localhost:5000/api/internal/reminders/run` | `{"sent":1,...}` and the Rent reminder in Mailpit at `http://localhost:8025` with the right name, amount, date and a link to `/bills` |
| Run the same command again | `{"sent":0,"skipped":1,...}` and no second email |
| Same command without the header, or with a wrong secret | `401`, no email |
| Stop Mailpit, add a bill due tomorrow, run the job | `failed: 1`; start Mailpit, run again: the email arrives |
| Try `GET /api/internal/reminders/run` and the same call with a normal user's token | 404 and 401 |

- [ ] **Step 2: Try the workflow file**

The scheduled workflow needs the repository on GitHub with `BACKEND_URL` and `CRON_SECRET` secrets, which M6 sets up. Until then, validate the YAML locally: `npx --yes @action-validator/cli .github/workflows/reminders.yml` (or paste it into GitHub's editor after pushing). Do not add either as a project dependency.

- [ ] **Step 3: Run the complete checks and finish the branch**

```bash
(cd backend && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
git status
```

Expected: everything passes, tree clean. Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `feature/fixed-expenses-reminders` into `main`.
