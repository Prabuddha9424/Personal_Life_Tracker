# M5 Dashboard and Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0 to M4 must be merged.

**Goal:** A "Today" dashboard that summarises tasks, money and bills from the other slices, and a Settings area with profile, password, theme, currency, data export and account deletion.

**Architecture:** A backend `account` slice that orchestrates the other slices **only through their `index.ts` public APIs** (export, delete, "has data", profile, password check, currency, user deletion). Frontend: the `dashboard` slice composes hooks and charts exported by `tasks`, `finance` and `fixed-expenses`; a new `account` slice holds the Settings page as independent sections.

**Tech Stack:** Express 5, Zod 4; React 19, TanStack Query, React Hook Form + Zod, Zustand (theme store). No new dependencies.

**Spec:** [`../PRD.md`](../PRD.md) DASH-1 to DASH-4, ACC-1 to ACC-4, AUTH-10 to AUTH-12, UI-2.

## Global Constraints

- The `account` slice imports from other slices only via `../auth/index.ts`, `../tasks/index.ts`, `../finance/index.ts`, `../fixed-expenses/index.ts`. The `dashboard` slice imports only from `@/features/tasks`, `@/features/finance`, `@/features/fixed-expenses`.
- Every account endpoint requires authentication and uses `authUserId(req)`. The password is never returned or logged.
- **Exports never contain password hashes or tokens.** CSV cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are neutralised with a leading `'` (CSV injection).
- **Delete account** requires the current password (`403 Incorrect password` otherwise), deletes tenant data first and the user last (so a failed attempt can be retried by a user who can still log in), clears the refresh cookie, and answers `204`. The endpoint is rate limited.
- **Currency** can change only while the user has no transactions and no fixed expenses (`409` otherwise). Tasks do not count.
- Money in exports keeps integer minor units (`amountMinor`) and also a decimal string built with integer arithmetic. No floats.
- Every dashboard card has its own loading, empty and error state; one failing card never blanks the others.
- The theme preference is stored in `localStorage` (a UI preference; JWTs never are).
- Work on branch `feature/dashboard-account`. Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Lint, typecheck and tests must pass before each commit.

## Review Focus

1. **CSV injection.** A task titled `=HYPERLINK("http://evil","x")`, a note starting with `+`, `-`, `@` or a tab must be neutralised in every CSV; ordinary text, quotes, commas and line breaks must round-trip. [Task 1 tests]
2. **Export scope.** The export contains exactly one user's data, and no `password`, hash, token or user id of anyone else. [Task 2 tests]
3. **Delete is all-or-retryable.** Wrong password deletes nothing. After success nothing of the user remains in any slice and other users are untouched. The old access token can no longer read the profile, create a transaction or create a bill. [Task 3 tests]
4. **Currency lock.** Allowed for an empty account, refused (`409`) once a transaction or bill exists, refused for an unsupported code. [Task 3 tests]
5. **One card down.** If the tasks summary fails, the money and bills cards still render and offer a retry for the failed one. [Task 5 test]
6. **Wrong password on delete** shows an error in the dialog and does not end the session. [Task 7 test]


## Carried over from the M3 review

Decisions and gaps found in the whole-branch review of M3 that land in this milestone:

1. **Reports assume one currency per user (change-currency race).** Every finance report `$sum`s ALL of a user's transactions and labels the total with the profile currency. In M3 a user cannot hold two currencies, but `changeCurrency` (Task 3) is check-then-set (`hasFinanceDataForUser`, then `setUserCurrency`): a transaction create or bulk import running at the same moment can read the OLD profile currency after the check passes and leave rows in a currency that no longer matches the labels. Task 3 must re-check `hasFinanceDataForUser` and `hasFixedExpensesForUser` AFTER `setUserCurrency` and revert the currency (409) on conflict, with a test that drives the race deterministically; alternatively make the reports defensive by adding `currency: profile.currency` to each aggregation `$match`. The transaction edit form already uses the transaction's stored currency.
2. **The dashboard's finance charts must agree on the current month.** The plan's Dashboard renders `<IncomeExpenseChart months={6} />` without `to`, so the server picks the current month in UTC while the spending chart beside it gets the LOCAL `currentMonthIso()`. Pass `to={currentMonthIso()}` to `IncomeExpenseChart` (and `NetTrendChart` if it is used), and add a test that the two charts request the same month near a month boundary.
3. **Export must neutralise spreadsheet formulas and cope with legacy rows.** `toCsv` neutralises leading `=`, `+`, `-`, `@` in text cells (already planned); the finance export must also tolerate a transaction with no category (`categoryId: ''` in the DTO after the M3 fix).
4. **Shared `Modal` and `fieldset disabled`.** The shared Modal's focusable selector still matches inputs inside a disabled fieldset, so Tab/Shift+Tab from Close can leave the dialog or do nothing while a save runs. Fix it in the shared Modal (exclude descendants of `fieldset:disabled` and other disabled/hidden elements) with a test; this affects the Settings forms built here.
5. **Account deletion must purge the finance seed marker too.** `deleteFinanceForUser` already deletes transactions, categories and the per-user `CategorySeed` row; the account-deletion test must assert that no finance document of the deleted user remains and another user's rows and marker are intact.

---

## Part A: Backend

### Task 1: CSV serialisation

**Files:**
- Create: `backend/src/features/account/csv.ts`, `csv.test.ts`, `decimal.ts`, `decimal.test.ts`

**Interfaces:**
- Produces: `type CsvCell = string | number | boolean | null | undefined`; `csvCell(value: CsvCell): string`; `toCsv(header: string[], rows: CsvCell[][]): string` (UTF-8 BOM, CRLF line endings, every field escaped, formula-neutralised); `minorToDecimal(minor: number, currency: string): string` (integer arithmetic only: `1234` USD gives `12.34`, `500` JPY gives `500`, `1234` BHD gives `1.234`).

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/dashboard-account
```

- [ ] **Step 1: Write the failing tests**

`backend/src/features/account/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from './csv.ts'

describe('csvCell', () => {
  it('leaves ordinary text and numbers alone', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(true)).toBe('true')
  })

  it('writes null and undefined as empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes fields containing commas, quotes or line breaks and doubles the quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"')
  })

  it.each([
    ['=HYPERLINK("http://evil","x")', '"\'=HYPERLINK(""http://evil"",""x"")"'],
    ['=1+1', "'=1+1"],
    ['+1', "'+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=cmd', "'\t=cmd"],
    ['\r=cmd', "\"'\r=cmd\""],
  ])('neutralises the formula-looking cell %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected)
  })

  it('does not touch a number that happens to be negative, or text that only contains a symbol', () => {
    expect(csvCell(-12.5)).toBe('-12.5')
    expect(csvCell('a=b')).toBe('a=b')
    expect(csvCell('5-3')).toBe('5-3')
  })
})

describe('toCsv', () => {
  it('writes a BOM, a header and CRLF-separated rows', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y'], [2, null]])).toBe('﻿a,b\r\n1,"x,y"\r\n2,\r\n')
  })

  it('writes just the header for no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('﻿a,b\r\n')
  })

  it('neutralises every cell, including ones that look like a header', () => {
    expect(toCsv(['title'], [['=evil()']])).toBe("﻿title\r\n'=evil()\r\n")
  })
})
```

`backend/src/features/account/decimal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { minorToDecimal } from './decimal.ts'

describe('minorToDecimal', () => {
  it.each([
    [1234, 'USD', '12.34'],
    [5, 'USD', '0.05'],
    [0, 'USD', '0.00'],
    [100000, 'USD', '1000.00'],
    [500, 'JPY', '500'],
    [1234, 'BHD', '1.234'],
    [7, 'BHD', '0.007'],
    [1_000_000_000_000, 'USD', '10000000000.00'],
  ])('writes %i minor units of %s as %s', (minor, currency, expected) => {
    expect(minorToDecimal(minor, currency)).toBe(expected)
  })
})
```

Run: `cd backend && npx vitest run src/features/account` → FAIL (modules missing).

- [ ] **Step 2: Implement**

`backend/src/features/account/csv.ts`:

```ts
export type CsvCell = string | number | boolean | null | undefined

/** A spreadsheet would run a text cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  // Only text is neutralised: a real negative number is not a formula.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** RFC 4180 CSV with a UTF-8 byte-order mark, so spreadsheet apps read accents correctly. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
```

`backend/src/features/account/decimal.ts`:

```ts
/** An integer amount of minor units as a plain decimal string, using no floating point. */
export function minorToDecimal(minor: number, currency: string): string {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  if (digits === 0) return String(minor)
  const padded = String(minor).padStart(digits + 1, '0')
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}
```

Run: `npx vitest run src/features/account` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(account): add CSV serialisation with formula neutralisation" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Data export endpoint

**Files:**
- Create: `backend/src/features/account/account.test-helpers.ts`, `export.service.ts`, `account.schemas.ts`, `account.controller.ts`, `account.routes.ts`, `index.ts`, `export.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `getUserProfile`, `exportTasksForUser`, `exportFinanceForUser`, `exportFixedExpensesForUser`, `toCsv`, `minorToDecimal`.
- Produces: `buildExport(userId): Promise<AccountExport>` with `AccountExport = { exportedAt: string; user: { email; name; currency }; tasks; categories; transactions; fixedExpenses }`; `datasetCsv(dataset, data): string`; route `GET /api/account/export?format=json|csv&dataset=tasks|transactions|fixed-expenses`; `accountRouter` (mounted at `/api/account`).
- Produces (test helpers): `signUp(overrides?)` returns `{ id, email, password, headers, cookie }` by registering, verifying and logging in through the real auth endpoints; `createTaskFor(user, title)`, `createTransactionFor(user, overrides?)`, `createBillFor(user, overrides?)`.

These tests run the real slices end to end (in-memory MongoDB, mocked mailer) because the account slice's job is to coordinate them.

- [ ] **Step 1: Write the test helpers**

`backend/src/features/account/account.test-helpers.ts`:

```ts
import request from 'supertest'
import { vi } from 'vitest'
import { app } from '../../app.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'

/** The test file must call vi.mock('../../shared/mailer/mailer.ts', ...) for this to be a mock. */
const sendMailMock = vi.mocked(sendMail)

export const PASSWORD = 'correct-horse-battery'

export interface TestAccount {
  id: string
  email: string
  password: string
  headers: { Authorization: string }
  cookie: string
}

let counter = 0

/** Registers, verifies and logs in a real user through the auth endpoints. */
export async function signUp(overrides: { currency?: string } = {}): Promise<TestAccount> {
  counter += 1
  const email = `account${counter}@example.com`
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Ada', email, password: PASSWORD, currency: overrides.currency ?? 'USD' })
    .expect(202)
  const token = /token=([a-f0-9]{64})/.exec(sendMailMock.mock.calls.at(-1)?.[0].text ?? '')?.[1]
  if (!token) throw new Error('No verification token in the last email')
  await request(app).post('/api/auth/verify-email').send({ token }).expect(200)

  const login = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)
  const cookies = login.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = cookies?.find((value) => value.startsWith('refresh_token='))?.split(';')[0] ?? ''
  return {
    id: login.body.user.id,
    email,
    password: PASSWORD,
    headers: { Authorization: `Bearer ${login.body.accessToken}` },
    cookie,
  }
}

export async function createTaskFor(user: TestAccount, title: string, extra: object = {}) {
  const res = await request(app).post('/api/tasks').set(user.headers).send({ title, ...extra }).expect(201)
  return res.body as { id: string }
}

export async function createTransactionFor(
  user: TestAccount,
  overrides: { kind?: 'income' | 'expense'; amountMinor?: number; note?: string; date?: string } = {},
) {
  const kind = overrides.kind ?? 'expense'
  const categories = await request(app).get(`/api/categories?kind=${kind}`).set(user.headers).expect(200)
  const res = await request(app)
    .post('/api/transactions')
    .set(user.headers)
    .send({
      kind,
      amountMinor: 1250,
      categoryId: categories.body.items[0].id,
      date: '2026-09-15',
      note: '',
      ...overrides,
    })
    .expect(201)
  return res.body as { id: string; currency: string }
}

export async function createBillFor(user: TestAccount, overrides: object = {}) {
  const res = await request(app)
    .post('/api/fixed-expenses')
    .set(user.headers)
    .send({ name: 'Rent', amountMinor: 125000, recurrence: 'monthly', anchorDate: '2030-01-01', ...overrides })
    .expect(201)
  return res.body as { id: string }
}
```

- [ ] **Step 2: Write the failing export tests**

`backend/src/features/account/export.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { createBillFor, createTaskFor, createTransactionFor, signUp } from './account.test-helpers.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const get = (url: string, headers: object) => request(app).get(url).set(headers)

describe('GET /api/account/export (JSON)', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/account/export').expect(401)
  })

  it("contains the user's own data and profile, as a download", async () => {
    const alice = await signUp({ currency: 'EUR' })
    await createTaskFor(alice, 'Buy milk', { tags: ['home'] })
    await createTransactionFor(alice, { note: 'Lunch', amountMinor: 1250 })
    await createBillFor(alice, { name: 'Rent' })

    const res = await get('/api/account/export?format=json', alice.headers)

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="tracker-export-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(res.body.exportedAt).toEqual(expect.any(String))
    expect(res.body.user).toEqual({ email: alice.email, name: 'Ada', currency: 'EUR' })
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['Buy milk'])
    expect(res.body.tasks[0].tags).toEqual(['home'])
    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.transactions[0]).toMatchObject({ note: 'Lunch', amountMinor: 1250, currency: 'EUR' })
    expect(res.body.categories.length).toBeGreaterThan(0)
    expect(res.body.fixedExpenses.map((b: { name: string }) => b.name)).toEqual(['Rent'])
  })

  it('defaults to JSON', async () => {
    const alice = await signUp()

    const res = await get('/api/account/export', alice.headers)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(alice.email)
  })

  it('never contains passwords, hashes, tokens or another user\'s data', async () => {
    const alice = await signUp()
    const bob = await signUp()
    await createTaskFor(alice, 'alice task')
    await createTaskFor(bob, 'bob secret task')
    await createTransactionFor(bob, { note: 'bob secret note' })
    await createBillFor(bob, { name: 'bob secret bill' })

    const res = await get('/api/account/export?format=json', alice.headers)

    const text = JSON.stringify(res.body)
    expect(text).not.toContain('bob')
    expect(text).not.toContain(alice.password)
    expect(text).not.toMatch(/\$2[aby]\$/)
    expect(text).not.toMatch(/passwor/i)
    expect(text).not.toMatch(/[a-f0-9]{64}/)
    expect(text).not.toContain(bob.id)
    expect(res.body.tasks).toHaveLength(1)
    expect(res.body.transactions).toHaveLength(0)
    expect(res.body.fixedExpenses).toHaveLength(0)
  })

  it('exports an empty account cleanly', async () => {
    const alice = await signUp()

    const res = await get('/api/account/export?format=json', alice.headers)

    expect(res.body).toMatchObject({ tasks: [], transactions: [], fixedExpenses: [] })
  })

  it.each(['?format=xml', '?format=csv', '?format=csv&dataset=users', '?dataset=tasks&format=json&x=1&format=csv'])(
    'rejects %s',
    async (query) => {
      const alice = await signUp()

      const res = await get(`/api/account/export${query}`, alice.headers)

      expect(res.status).toBe(400)
    },
  )
})

describe('GET /api/account/export (CSV)', () => {
  const csv = (dataset: string, headers: object) =>
    get(`/api/account/export?format=csv&dataset=${dataset}`, headers)

  it('exports tasks as a downloadable CSV', async () => {
    const alice = await signUp()
    await createTaskFor(alice, 'Pay rent', { priority: 'high', dueDate: '2026-10-01', tags: ['home', 'bills'] })

    const res = await csv('tasks', alice.headers)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="tracker-tasks-\d{4}-\d{2}-\d{2}\.csv"$/)
    const lines = res.text.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('title,description,status,priority,due_date,tags,created_at')
    expect(lines[1]).toMatch(/^Pay rent,,todo,high,2026-10-01,home; bills,\d{4}-\d{2}-\d{2}T/)
  })

  it('exports transactions with the category name and an exact decimal amount', async () => {
    const alice = await signUp({ currency: 'JPY' })
    await createTransactionFor(alice, { note: 'Ramen, extra egg', amountMinor: 900 })

    const res = await csv('transactions', alice.headers)

    const lines = res.text.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('date,type,category,amount,amount_minor,currency,note')
    expect(lines[1]).toMatch(/^2026-09-15,expense,[^,]+,900,900,JPY,"Ramen, extra egg"$/)
  })

  it('exports bills', async () => {
    const alice = await signUp()
    await createBillFor(alice, { name: 'Rent', amountMinor: 125000, leadDays: 5 })

    const res = await csv('fixed-expenses', alice.headers)

    const lines = res.text.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe(
      'name,label,amount,amount_minor,currency,repeats,first_due_date,next_due_date,remind_days_before,reminders,active',
    )
    expect(lines[1]).toBe('Rent,,1250.00,125000,USD,monthly,2030-01-01,2030-01-01,5,true,true')
  })

  it('neutralises formulas in user-written text in every dataset', async () => {
    const alice = await signUp()
    await createTaskFor(alice, '=HYPERLINK("http://evil","x")', { description: '+1' })
    await createTransactionFor(alice, { note: '@SUM(A1)' })
    await createBillFor(alice, { name: '-2+3', label: '=x' })

    const tasks = (await csv('tasks', alice.headers)).text
    const transactions = (await csv('transactions', alice.headers)).text
    const bills = (await csv('fixed-expenses', alice.headers)).text

    expect(tasks).toContain('"\'=HYPERLINK(""http://evil"",""x"")"')
    expect(tasks).toContain(",'+1,")
    expect(transactions).toContain(",'@SUM(A1)")
    expect(bills).toContain("'-2+3,'=x,")
    expect(tasks + transactions + bills).not.toMatch(/(^|,|\r\n)[=+@]/)
  })

  it("contains only the user's own rows", async () => {
    const alice = await signUp()
    const bob = await signUp()
    await createTaskFor(bob, 'bob secret task')

    const res = await csv('tasks', alice.headers)

    expect(res.text).not.toContain('bob secret task')
  })
})
```

Run: `npx vitest run src/features/account/export.test.ts` → FAIL (404).

- [ ] **Step 3: Implement the export service**

`backend/src/features/account/export.service.ts`:

```ts
import { AppError } from '../../shared/errors/AppError.ts'
import { getUserProfile } from '../auth/index.ts'
import {
  exportFinanceForUser,
  type CategoryDto,
  type TransactionDto,
} from '../finance/index.ts'
import { exportFixedExpensesForUser, type FixedExpenseDto } from '../fixed-expenses/index.ts'
import { exportTasksForUser, type TaskDto } from '../tasks/index.ts'
import { toCsv } from './csv.ts'
import { minorToDecimal } from './decimal.ts'

export interface AccountExport {
  exportedAt: string
  user: { email: string; name: string; currency: string }
  tasks: TaskDto[]
  categories: CategoryDto[]
  transactions: TransactionDto[]
  fixedExpenses: FixedExpenseDto[]
}

export const DATASETS = ['tasks', 'transactions', 'fixed-expenses'] as const
export type Dataset = (typeof DATASETS)[number]

/** Everything one user owns. Only public fields: no password, hash, token or id. */
export async function buildExport(userId: string): Promise<AccountExport> {
  const [profile, tasks, finance, fixedExpenses] = await Promise.all([
    getUserProfile(userId),
    exportTasksForUser(userId),
    exportFinanceForUser(userId),
    exportFixedExpensesForUser(userId),
  ])
  if (!profile) throw new AppError(401, 'Not authorized')

  return {
    exportedAt: new Date().toISOString(),
    user: { email: profile.email, name: profile.name, currency: profile.currency },
    tasks,
    categories: finance.categories,
    transactions: finance.transactions,
    fixedExpenses,
  }
}

export function datasetCsv(dataset: Dataset, data: AccountExport): string {
  switch (dataset) {
    case 'tasks':
      return toCsv(
        ['title', 'description', 'status', 'priority', 'due_date', 'tags', 'created_at'],
        data.tasks.map((task) => [
          task.title,
          task.description,
          task.status,
          task.priority,
          task.dueDate,
          task.tags.join('; '),
          task.createdAt,
        ]),
      )
    case 'transactions': {
      const nameById = new Map(data.categories.map((category) => [category.id, category.name]))
      return toCsv(
        ['date', 'type', 'category', 'amount', 'amount_minor', 'currency', 'note'],
        data.transactions.map((tx) => [
          tx.date,
          tx.kind,
          nameById.get(tx.categoryId) ?? 'Deleted category',
          minorToDecimal(tx.amountMinor, tx.currency),
          tx.amountMinor,
          tx.currency,
          tx.note,
        ]),
      )
    }
    case 'fixed-expenses':
      return toCsv(
        [
          'name',
          'label',
          'amount',
          'amount_minor',
          'currency',
          'repeats',
          'first_due_date',
          'next_due_date',
          'remind_days_before',
          'reminders',
          'active',
        ],
        data.fixedExpenses.map((bill) => [
          bill.name,
          bill.label,
          minorToDecimal(bill.amountMinor, bill.currency),
          bill.amountMinor,
          bill.currency,
          bill.recurrence,
          bill.anchorDate,
          bill.nextDueDate,
          bill.leadDays,
          bill.remindersEnabled,
          bill.active,
        ]),
      )
  }
}
```

The `finance` and `fixed-expenses` index files must export their DTO types for this import. Both already do (`export type { CategoryDto, TransactionDto }` and `export type { FixedExpenseDto }`).

- [ ] **Step 4: Schemas, controller, routes and wiring**

`backend/src/features/account/account.schemas.ts`:

```ts
import { z } from 'zod'
import { DATASETS } from './export.service.ts'

export const exportQuerySchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
    dataset: z.enum(DATASETS).optional(),
  })
  .refine((query) => query.format === 'json' || query.dataset !== undefined, {
    message: 'Choose a dataset for a CSV export',
    path: ['dataset'],
  })

export type ExportQuery = z.infer<typeof exportQuerySchema>
```

`backend/src/features/account/account.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { ExportQuery } from './account.schemas.ts'
import { buildExport, datasetCsv } from './export.service.ts'

export async function exportData(req: Request, res: Response) {
  const { format, dataset } = req.query as unknown as ExportQuery
  const data = await buildExport(authUserId(req))
  const day = data.exportedAt.slice(0, 10)

  if (format === 'csv' && dataset) {
    res.type('text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="tracker-${dataset}-${day}.csv"`)
    res.send(datasetCsv(dataset, data))
    return
  }

  res.setHeader('Content-Disposition', `attachment; filename="tracker-export-${day}.json"`)
  res.json(data)
}
```

`backend/src/features/account/account.routes.ts`:

```ts
import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { validate } from '../../shared/middleware/validate.ts'
import { exportData } from './account.controller.ts'
import { exportQuerySchema } from './account.schemas.ts'

export const accountRouter = Router()

accountRouter.use(requireAuth)
accountRouter.get('/export', validate({ query: exportQuerySchema }), exportData)
```

`backend/src/features/account/index.ts`:

```ts
export { accountRouter } from './account.routes.ts'
```

In `backend/src/app.ts` add `import { accountRouter } from './features/account/index.ts'` and mount it after the reminders router: `app.use('/api/account', accountRouter)`.

Run: `npx vitest run src/features/account` → PASS. The case `?dataset=tasks&format=json&x=1&format=csv` repeats `format`, which Express parses as an array, so `z.enum` rejects it with 400 as the test expects.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(account): add JSON and CSV data export" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Change currency and delete account

**Files:**
- Create: `backend/src/features/account/account.service.ts`, `account.lifecycle.test.ts`
- Modify: `backend/src/features/account/account.schemas.ts`, `account.controller.ts`, `account.routes.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `setUserCurrency`, `getUserProfile`, `deleteUser`, `clearRefreshCookie` (auth); the `delete…ForUser` and `has…DataForUser` functions of the other slices.
- Produces: `changeCurrency(userId, currency): Promise<UserProfile>` (`409` when the user has transactions or bills), `deleteAccount(userId, password): Promise<void>` (`403` for a wrong password); routes `PATCH /api/account/currency` (`{ currency }` → `200 { user }`) and `DELETE /api/account` (`{ password }` → `204`, rate limited).

- [ ] **Step 1: Write the failing tests**

`backend/src/features/account/account.lifecycle.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { createBillFor, createTaskFor, createTransactionFor, signUp } from './account.test-helpers.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const changeCurrency = (headers: object, body: object) =>
  request(app).patch('/api/account/currency').set(headers).send(body)
const deleteAccount = (headers: object, body: object) =>
  request(app).delete('/api/account').set(headers).send(body)
const me = (headers: object) => request(app).get('/api/auth/me').set(headers)

describe('PATCH /api/account/currency', () => {
  it('requires authentication', async () => {
    await request(app).patch('/api/account/currency').send({ currency: 'EUR' }).expect(401)
  })

  it('changes the currency of an empty account, and later transactions use it', async () => {
    const alice = await signUp({ currency: 'USD' })

    const res = await changeCurrency(alice.headers, { currency: 'eur' })

    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ email: alice.email, currency: 'EUR' })
    expect((await me(alice.headers)).body.user.currency).toBe('EUR')
    expect((await createTransactionFor(alice)).currency).toBe('EUR')
  })

  it('still allows the change when the user only has tasks', async () => {
    const alice = await signUp()
    await createTaskFor(alice, 'a task')

    await changeCurrency(alice.headers, { currency: 'GBP' }).expect(200)
  })

  it('refuses once a transaction exists, and leaves the currency alone', async () => {
    const alice = await signUp({ currency: 'USD' })
    await createTransactionFor(alice)

    const res = await changeCurrency(alice.headers, { currency: 'EUR' })

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/before you add transactions or bills/i)
    expect((await me(alice.headers)).body.user.currency).toBe('USD')
  })

  it('refuses once a bill exists', async () => {
    const alice = await signUp()
    await createBillFor(alice)

    await changeCurrency(alice.headers, { currency: 'EUR' }).expect(409)
  })

  it('is not blocked by another user\'s data', async () => {
    const alice = await signUp()
    const bob = await signUp()
    await createTransactionFor(bob)

    await changeCurrency(alice.headers, { currency: 'EUR' }).expect(200)
  })

  it.each([{ currency: 'ZZZ' }, { currency: 'us' }, { currency: 5 }, {}])('rejects %j', async (body) => {
    const alice = await signUp()

    const res = await changeCurrency(alice.headers, body)

    expect(res.status).toBe(400)
    expect((await me(alice.headers)).body.user.currency).toBe('USD')
  })
})

describe('DELETE /api/account', () => {
  it('requires authentication', async () => {
    await request(app).delete('/api/account').send({ password: 'x' }).expect(401)
  })

  it('refuses a wrong or missing password and deletes nothing', async () => {
    const alice = await signUp()
    await createTaskFor(alice, 'keep me')

    const wrong = await deleteAccount(alice.headers, { password: 'not-my-password' })
    const missing = await deleteAccount(alice.headers, {})

    expect(wrong.status).toBe(403)
    expect(wrong.body).toEqual({ message: 'Incorrect password' })
    expect(missing.status).toBe(400)
    expect((await me(alice.headers)).status).toBe(200)
    expect((await request(app).get('/api/tasks').set(alice.headers)).body.total).toBe(1)
  })

  it("removes the user and everything they own, and nothing of anyone else's", async () => {
    const alice = await signUp()
    const bob = await signUp()
    await createTaskFor(alice, 'alice task')
    await createTransactionFor(alice)
    await createBillFor(alice)
    await createTaskFor(bob, 'bob task')
    await createTransactionFor(bob)
    await createBillFor(bob)

    const res = await deleteAccount(alice.headers, { password: alice.password })

    expect(res.status).toBe(204)
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refresh_token=;'))
    expect(cleared).toContain('Path=/api/auth')

    const login = await request(app).post('/api/auth/login').send({ email: alice.email, password: alice.password })
    expect(login.status).toBe(401)
    await request(app).post('/api/auth/refresh').set('Cookie', alice.cookie).expect(401)

    expect((await request(app).get('/api/tasks').set(bob.headers)).body.total).toBe(1)
    expect((await request(app).get('/api/transactions').set(bob.headers)).body.total).toBe(1)
    expect((await request(app).get('/api/fixed-expenses').set(bob.headers)).body.total).toBe(1)
    expect((await me(bob.headers)).status).toBe(200)
  })

  it('a deleted account can no longer export anything', async () => {
    const first = await signUp()
    await createTaskFor(first, 'old task')
    await deleteAccount(first.headers, { password: first.password }).expect(204)

    const exported = await request(app).get('/api/account/export').set(first.headers)

    expect(exported.status).toBe(401)
  })

  it('the old access token cannot read the profile, create a transaction or create a bill', async () => {
    const alice = await signUp()
    const categories = await request(app).get('/api/categories?kind=expense').set(alice.headers)
    await deleteAccount(alice.headers, { password: alice.password }).expect(204)

    await me(alice.headers).expect(401)
    await request(app)
      .post('/api/transactions')
      .set(alice.headers)
      .send({ kind: 'expense', amountMinor: 100, categoryId: categories.body.items[0].id, date: '2026-09-01' })
      .expect(401)
    await request(app)
      .post('/api/fixed-expenses')
      .set(alice.headers)
      .send({ name: 'x', amountMinor: 100, recurrence: 'monthly', anchorDate: '2030-01-01' })
      .expect(401)
  })
})
```

Run → FAIL (404 on the new routes).

- [ ] **Step 2: Implement the service**

`backend/src/features/account/account.service.ts`:

```ts
import { AppError } from '../../shared/errors/AppError.ts'
import {
  deleteUser,
  getUserProfile,
  setUserCurrency,
  verifyPassword,
  type UserProfile,
} from '../auth/index.ts'
import { deleteFinanceForUser, hasFinanceDataForUser } from '../finance/index.ts'
import { deleteFixedExpensesForUser, hasFixedExpensesForUser } from '../fixed-expenses/index.ts'
import { deleteTasksForUser } from '../tasks/index.ts'

/** Amounts are stored in the user's currency, so it can only change while there are none. */
export async function changeCurrency(userId: string, currency: string): Promise<UserProfile> {
  const [hasTransactions, hasBills] = await Promise.all([
    hasFinanceDataForUser(userId),
    hasFixedExpensesForUser(userId),
  ])
  if (hasTransactions || hasBills) {
    throw new AppError(409, 'Your currency can only be changed before you add transactions or bills')
  }

  await setUserCurrency(userId, currency)
  const profile = await getUserProfile(userId)
  if (!profile) throw new AppError(401, 'Not authorized')
  return profile
}

/**
 * Deletes the tenant data of every slice first and the user last. If something fails half way,
 * the user still exists and can log in and try again (each step is safe to repeat).
 */
export async function deleteAccount(userId: string, password: string): Promise<void> {
  if (!(await verifyPassword(userId, password))) throw new AppError(403, 'Incorrect password')

  await deleteTasksForUser(userId)
  await deleteFinanceForUser(userId)
  await deleteFixedExpensesForUser(userId)
  await deleteUser(userId)
}
```

- [ ] **Step 3: Schemas, controller, routes**

Append to `backend/src/features/account/account.schemas.ts`:

```ts
export const changeCurrencySchema = z.object({ currency: z.string().length(3) })

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) })
```

Append to `backend/src/features/account/account.controller.ts` (add the imports at the top):

```ts
import { clearRefreshCookie } from '../auth/index.ts'
import * as accountService from './account.service.ts'
```

```ts
export async function changeCurrency(req: Request, res: Response) {
  const { currency } = req.body as { currency: string }
  res.json({ user: await accountService.changeCurrency(authUserId(req), currency) })
}

export async function deleteAccount(req: Request, res: Response) {
  const { password } = req.body as { password: string }
  await accountService.deleteAccount(authUserId(req), password)
  clearRefreshCookie(res)
  res.status(204).end()
}
```

In `account.routes.ts` extend the imports (`authRateLimiter` from `../../shared/middleware/rateLimiters.ts`, `changeCurrency`, `deleteAccount` from the controller, `changeCurrencySchema`, `deleteAccountSchema` from the schemas) and append:

```ts
accountRouter.patch('/currency', validate({ body: changeCurrencySchema }), changeCurrency)
accountRouter.delete('/', authRateLimiter, validate({ body: deleteAccountSchema }), deleteAccount)
```

Run: `npx vitest run src/features/account` → PASS. A `ZodError` thrown by `setUserCurrency` for an unsupported code such as `ZZZ` is formatted by the central error handler as `400 Validation failed`, which is what the currency test expects.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(account): add currency change and password-confirmed account deletion" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B: Frontend

All commands in Part B run from `frontend/`.

### Task 4: Public API additions for the dashboard and Settings

**Files:**
- Modify: `frontend/src/features/auth/index.ts`, `frontend/src/features/fixed-expenses/index.ts`
- Create: `frontend/src/features/auth/index.test.ts`

**Interfaces:**
- Produces: `endSession` exported from `@/features/auth` (signs out locally and clears every cached query; used after account deletion), `dueLabel` exported from `@/features/fixed-expenses` (used by the dashboard's bills card).

- [ ] **Step 1: Write a test that pins the public API**

`frontend/src/features/auth/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as auth from './index'

describe('auth public API', () => {
  it('exposes what other slices need', () => {
    expect(Object.keys(auth).sort()).toEqual([
      'ProtectedRoute',
      'SessionGate',
      'UserMenu',
      'authRoutes',
      'endSession',
      'initAuth',
      'updateSessionUser',
      'useChangePassword',
      'useSessionUser',
      'useUpdateProfile',
    ])
  })
})
```

Run: `npx vitest run src/features/auth/index.test.ts` → FAIL (`endSession` is not exported).

- [ ] **Step 2: Export them**

Replace `frontend/src/features/auth/index.ts`:

```ts
export { useChangePassword, useSessionUser, useUpdateProfile } from './api/hooks'
export { ProtectedRoute } from './components/ProtectedRoute'
export { SessionGate } from './components/SessionGate'
export { UserMenu } from './components/UserMenu'
export { authRoutes } from './routes'
export { endSession, initAuth, updateSessionUser } from './session'
```

Replace `frontend/src/features/fixed-expenses/index.ts`:

```ts
export { useUpcomingBills } from './api/hooks'
export { dueLabel } from './dueLabel'
export { billRoutes } from './routes'
```

Run the tests → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(auth,fixed-expenses): export endSession and dueLabel for the dashboard and settings" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: The "Today" dashboard

**Files:**
- Create under `frontend/src/features/dashboard/`: `components/TasksDueCard.tsx`, `components/NetCard.tsx`, `components/BillsCard.tsx`, `dashboard.css`
- Modify: `frontend/src/features/dashboard/pages/DashboardPage.tsx`, `frontend/src/features/dashboard/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `useDueSoonTasks` (tasks), `useMonthSummary`, `SpendingByCategoryChart`, `IncomeExpenseChart` (finance), `useUpcomingBills`, `dueLabel` (fixed-expenses).
- Produces: the dashboard page with three summary cards and two charts. Each card handles its own loading, empty and error state.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/features/dashboard/DashboardPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysIso, currentMonthIso, todayIso } from '@/shared/lib/dates'
import { renderWithProviders } from '@/test/render'
import DashboardPage from './pages/DashboardPage'

interface QueryLike {
  isPending: boolean
  isError: boolean
  isSuccess: boolean
  data: unknown
  refetch: () => void
}

const state = vi.hoisted(() => ({
  tasks: {} as unknown,
  summary: {} as unknown,
  bills: {} as unknown,
}))

vi.mock('@/features/tasks', () => ({ useDueSoonTasks: () => state.tasks }))
vi.mock('@/features/finance', () => ({
  useMonthSummary: () => state.summary,
  SpendingByCategoryChart: ({ month }: { month: string }) => <div data-testid="spending" data-month={month} />,
  IncomeExpenseChart: ({ months }: { months: number }) => <div data-testid="income-expense" data-months={months} />,
}))
vi.mock('@/features/fixed-expenses', async () => {
  const { daysBetween } = await import('@/shared/lib/dates')
  return {
    useUpcomingBills: () => state.bills,
    dueLabel: (due: string, today: string) => ({ text: `in ${daysBetween(today, due)} days`, tone: 'soon' }),
  }
})

const ok = (data: unknown): QueryLike => ({ isPending: false, isError: false, isSuccess: true, data, refetch: vi.fn() })
const pending: QueryLike = { isPending: true, isError: false, isSuccess: false, data: undefined, refetch: vi.fn() }
const failed = (): QueryLike => ({ isPending: false, isError: true, isSuccess: false, data: undefined, refetch: vi.fn() })

const inDays = (days: number) => addDaysIso(todayIso(), days)
const task = (id: string, title: string, dueDate: string) => ({ id, title, dueDate, status: 'todo' })

beforeEach(() => {
  state.tasks = ok({ items: [], page: 1, limit: 50, total: 0 })
  state.summary = ok({ month: currentMonthIso(), currency: 'USD', incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
  state.bills = ok({ items: [], page: 1, limit: 3, total: 0 })
})

describe('DashboardPage', () => {
  it('greets with the page title and shows the two charts for the current month', () => {
    renderWithProviders(<DashboardPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByTestId('spending')).toHaveAttribute('data-month', currentMonthIso())
    expect(screen.getByTestId('income-expense')).toHaveAttribute('data-months', '6')
  })

  it('summarises tasks due soon and counts the overdue ones', async () => {
    state.tasks = ok({
      items: [task('1', 'Pay rent', inDays(-2)), task('2', 'Call mum', inDays(3))],
      page: 1,
      limit: 50,
      total: 2,
    })

    renderWithProviders(<DashboardPage />)

    const card = screen.getByRole('region', { name: 'Tasks due this week' })
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).getByText('1 overdue')).toBeInTheDocument()
    expect(within(card).getByText('Pay rent')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open the board' })).toHaveAttribute('href', '/board')
  })

  it('says when nothing is due', () => {
    renderWithProviders(<DashboardPage />)

    const card = screen.getByRole('region', { name: 'Tasks due this week' })
    expect(within(card).getByText('Nothing due this week')).toBeInTheDocument()
  })

  it('shows this month\'s net with income and expenses, and links to Finance', () => {
    state.summary = ok({
      month: currentMonthIso(),
      currency: 'USD',
      incomeMinor: 300000,
      expenseMinor: 8700,
      netMinor: 291300,
    })

    renderWithProviders(<DashboardPage />)

    const card = screen.getByRole('region', { name: 'Net this month' })
    expect(within(card).getByText('$2,913.00')).toBeInTheDocument()
    expect(within(card).getByText('$3,000.00')).toBeInTheDocument()
    expect(within(card).getByText('$87.00')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open finance' })).toHaveAttribute('href', '/finance')
  })

  it('marks a negative net and invites a first transaction when the month is empty', () => {
    state.summary = ok({ month: currentMonthIso(), currency: 'USD', incomeMinor: 0, expenseMinor: 999, netMinor: -999 })
    const { unmount } = renderWithProviders(<DashboardPage />)
    expect(within(screen.getByRole('region', { name: 'Net this month' })).getByText('-$9.99')).toHaveClass('is-negative')
    unmount()

    state.summary = ok({ month: currentMonthIso(), currency: 'USD', incomeMinor: 0, expenseMinor: 0, netMinor: 0 })
    renderWithProviders(<DashboardPage />)
    expect(screen.getByText('No transactions this month yet')).toBeInTheDocument()
  })

  it('lists the next bills with how soon they are due and their amounts', () => {
    state.bills = ok({
      items: [
        { id: '1', name: 'Rent', amountMinor: 125000, currency: 'USD', nextDueDate: inDays(2) },
        { id: '2', name: 'Netflix', amountMinor: 1599, currency: 'USD', nextDueDate: inDays(5) },
      ],
      page: 1,
      limit: 3,
      total: 2,
    })

    renderWithProviders(<DashboardPage />)

    const card = screen.getByRole('region', { name: 'Next bills' })
    expect(within(card).getByText('Rent')).toBeInTheDocument()
    expect(within(card).getByText('in 2 days')).toBeInTheDocument()
    expect(within(card).getByText('$1,250.00')).toBeInTheDocument()
    expect(within(card).getByText('Netflix')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'All bills' })).toHaveAttribute('href', '/bills')
  })

  it('invites the first bill when there are none', () => {
    renderWithProviders(<DashboardPage />)

    const card = screen.getByRole('region', { name: 'Next bills' })
    expect(within(card).getByText('No bills yet')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Add a bill' })).toHaveAttribute('href', '/bills')
  })

  it('shows a loading state per card', () => {
    state.tasks = pending
    state.summary = pending
    state.bills = pending

    renderWithProviders(<DashboardPage />)

    expect(screen.getAllByRole('status')).toHaveLength(3)
  })

  it('one card failing does not blank the others, and the failed one can retry', async () => {
    const tasks = failed()
    state.tasks = tasks
    state.summary = ok({ month: currentMonthIso(), currency: 'USD', incomeMinor: 100, expenseMinor: 0, netMinor: 100 })
    state.bills = ok({ items: [{ id: '1', name: 'Rent', amountMinor: 100, currency: 'USD', nextDueDate: inDays(1) }], page: 1, limit: 3, total: 1 })

    renderWithProviders(<DashboardPage />)

    const tasksCard = screen.getByRole('region', { name: 'Tasks due this week' })
    expect(within(tasksCard).getByRole('alert')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Net this month' })).getAllByText('$1.00').length).toBeGreaterThan(0)
    expect(within(screen.getByRole('region', { name: 'Next bills' })).getByText('Rent')).toBeInTheDocument()

    await userEvent.click(within(tasksCard).getByRole('button', { name: 'Try again' }))
    expect(tasks.refetch).toHaveBeenCalledTimes(1)
  })
})
```

Run: `npx vitest run src/features/dashboard` → FAIL (the page still renders the old heading).

The cards need accessible region names. `Card` renders a `<section>` whose title is an `<h2>`; a `<section>` becomes a `region` only when it has an accessible name. Update `frontend/src/shared/ui/Card.tsx` so a titled card labels itself:

```tsx
import { useId, type ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
}

export function Card({ title, children, className }: CardProps) {
  const titleId = useId()
  return (
    <section className={['card', className].filter(Boolean).join(' ')} aria-labelledby={title ? titleId : undefined}>
      {title && (
        <h2 id={titleId} className="card__title">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
```

The existing `Card` usages (finance summary cards and page cards) keep working; they now also have region names.

- [ ] **Step 2: Implement the cards and the page**

`frontend/src/features/dashboard/components/TasksDueCard.tsx`:

```tsx
import { Link } from 'react-router'
import { useDueSoonTasks } from '@/features/tasks'
import { formatDate, todayIso } from '@/shared/lib/dates'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import '../dashboard.css'

export function TasksDueCard() {
  const query = useDueSoonTasks(7)
  const today = todayIso()
  const overdue =
    query.data?.items.filter((task) => task.dueDate !== null && task.dueDate < today).length ?? 0

  return (
    <Card title="Tasks due this week">
      {query.isPending && <LoadingState label="Loading tasks…" />}
      {query.isError && <ErrorState message="Could not load tasks" onRetry={() => query.refetch()} />}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState title="Nothing due this week" action={<Link to="/board">Open the board</Link>} />
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <p className="dash__big">
            {query.data.total} <span className="muted">due or overdue</span>
          </p>
          {overdue > 0 && <p className="is-negative">{`${overdue} overdue`}</p>}
          <ul className="dash__list">
            {query.data.items.slice(0, 5).map((task) => (
              <li key={task.id}>
                <span>{task.title}</span>
                {task.dueDate && <span className="muted">{formatDate(task.dueDate)}</span>}
              </li>
            ))}
          </ul>
          <Link to="/board">Open the board</Link>
        </>
      )}
    </Card>
  )
}
```

`frontend/src/features/dashboard/components/NetCard.tsx`:

```tsx
import { Link } from 'react-router'
import { useMonthSummary } from '@/features/finance'
import { currentMonthIso } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import '../dashboard.css'

export function NetCard() {
  const query = useMonthSummary(currentMonthIso())

  return (
    <Card title="Net this month">
      {query.isPending && <LoadingState label="Loading totals…" />}
      {query.isError && <ErrorState message="Could not load totals" onRetry={() => query.refetch()} />}

      {query.isSuccess && query.data.incomeMinor === 0 && query.data.expenseMinor === 0 && (
        <EmptyState
          title="No transactions this month yet"
          action={<Link to="/finance">Add a transaction</Link>}
        />
      )}

      {query.isSuccess && (query.data.incomeMinor !== 0 || query.data.expenseMinor !== 0) && (
        <>
          <p className={`dash__big${query.data.netMinor < 0 ? ' is-negative' : ' is-positive'}`}>
            {formatMinorUnits(query.data.netMinor, query.data.currency)}
          </p>
          <dl className="dash__split">
            <div>
              <dt className="muted">Income</dt>
              <dd>{formatMinorUnits(query.data.incomeMinor, query.data.currency)}</dd>
            </div>
            <div>
              <dt className="muted">Expenses</dt>
              <dd>{formatMinorUnits(query.data.expenseMinor, query.data.currency)}</dd>
            </div>
          </dl>
          <Link to="/finance">Open finance</Link>
        </>
      )}
    </Card>
  )
}
```

`frontend/src/features/dashboard/components/BillsCard.tsx`:

```tsx
import { Link } from 'react-router'
import { dueLabel, useUpcomingBills } from '@/features/fixed-expenses'
import { todayIso } from '@/shared/lib/dates'
import { formatMinorUnits } from '@/shared/lib/money'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/StateViews'
import '../dashboard.css'

export function BillsCard() {
  const query = useUpcomingBills(3)
  const today = todayIso()

  return (
    <Card title="Next bills">
      {query.isPending && <LoadingState label="Loading bills…" />}
      {query.isError && <ErrorState message="Could not load bills" onRetry={() => query.refetch()} />}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState title="No bills yet" action={<Link to="/bills">Add a bill</Link>} />
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <>
          <ul className="dash__list">
            {query.data.items.map((bill) => {
              const label = dueLabel(bill.nextDueDate, today)
              return (
                <li key={bill.id}>
                  <span>
                    <strong>{bill.name}</strong>
                    <span className={`due--${label.tone}`}> {label.text}</span>
                  </span>
                  <span>{formatMinorUnits(bill.amountMinor, bill.currency)}</span>
                </li>
              )
            })}
          </ul>
          <Link to="/bills">All bills</Link>
        </>
      )}
    </Card>
  )
}
```

`frontend/src/features/dashboard/pages/DashboardPage.tsx`:

```tsx
import { IncomeExpenseChart, SpendingByCategoryChart } from '@/features/finance'
import { currentMonthIso } from '@/shared/lib/dates'
import { Card } from '@/shared/ui/Card'
import { BillsCard } from '../components/BillsCard'
import { NetCard } from '../components/NetCard'
import { TasksDueCard } from '../components/TasksDueCard'
import '../dashboard.css'

export default function DashboardPage() {
  return (
    <div className="dash">
      <h1>Today</h1>
      <div className="dash__cards">
        <TasksDueCard />
        <NetCard />
        <BillsCard />
      </div>
      <div className="dash__charts">
        <Card title="Spending by category">
          <SpendingByCategoryChart month={currentMonthIso()} />
        </Card>
        <Card title="Income vs expenses">
          <IncomeExpenseChart months={6} />
        </Card>
      </div>
    </div>
  )
}
```

`frontend/src/features/dashboard/dashboard.css`:

```css
.dash {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.dash h1 {
  margin: 0;
}
.dash__cards,
.dash__charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
}
.dash__charts {
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
.dash__big {
  margin: 0 0 var(--space-2);
  font-size: 1.8rem;
  font-weight: 700;
}
.dash__list {
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
}
.dash__list li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) 0;
}
.dash__split {
  display: flex;
  gap: var(--space-6);
  margin: 0 0 var(--space-3);
}
.dash__split dt {
  font-size: 0.85rem;
}
.dash__split dd {
  margin: 0;
  font-weight: 600;
}
.is-positive {
  color: var(--positive);
}
.is-negative {
  color: var(--danger);
}
.due--overdue {
  color: var(--danger);
}
.due--today,
.due--soon {
  color: var(--warning);
}
.due--later {
  color: var(--text-muted);
}
```

The dashboard page and its tests use `dueLabel`'s `tone` class names (`due--…`); their styles are defined here so the dashboard does not depend on the bills slice's stylesheet.

Run: `npx vitest run src/features/dashboard` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add frontend
git commit -m "feat(dashboard): add the Today dashboard with independent summary cards and charts" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Account API, download helper, profile, password and appearance

**Files:**
- Create under `frontend/src/features/account/`: `api/accountApi.ts`, `download.ts`, `download.test.ts`, `components/ProfileSection.tsx`, `ProfileSection.test.tsx`, `PasswordSection.tsx`, `PasswordSection.test.tsx`, `AppearanceSection.tsx`, `AppearanceSection.test.tsx`, `account.css`

**Interfaces:**
- Produces: `changeCurrency(currency): Promise<{ user: { id; email; name; currency } }>`, `deleteAccount(password): Promise<void>`, `downloadExport(params): Promise<{ blob: Blob; filename: string }>` with `params: { format: 'json' } | { format: 'csv'; dataset: 'tasks' | 'transactions' | 'fixed-expenses' }`; `saveBlob(blob, filename): void`; `ProfileSection()`, `PasswordSection()`, `AppearanceSection()`.

- [ ] **Step 1: Write the API and the download helper with its test**

`frontend/src/features/account/api/accountApi.ts`:

```ts
import { httpClient } from '@/shared/api/httpClient'

export type ExportParams =
  | { format: 'json' }
  | { format: 'csv'; dataset: 'tasks' | 'transactions' | 'fixed-expenses' }

export async function changeCurrency(currency: string) {
  const { data } = await httpClient.patch<{
    user: { id: string; email: string; name: string; currency: string }
  }>('/account/currency', { currency })
  return data
}

export async function deleteAccount(password: string): Promise<void> {
  await httpClient.delete('/account', { data: { password } })
}

function filenameFrom(header: unknown, fallback: string): string {
  const match = typeof header === 'string' ? /filename="([^"]+)"/.exec(header) : null
  return match?.[1] ?? fallback
}

export async function downloadExport(params: ExportParams): Promise<{ blob: Blob; filename: string }> {
  const response = await httpClient.get<Blob>('/account/export', { params, responseType: 'blob' })
  const fallback = params.format === 'json' ? 'tracker-export.json' : `tracker-${params.dataset}.csv`
  return { blob: response.data, filename: filenameFrom(response.headers['content-disposition'], fallback) }
}
```

`frontend/src/features/account/download.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBlob } from './download'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveBlob', () => {
  it('downloads the blob under the given name and releases the temporary URL', () => {
    const create = vi.fn(() => 'blob:temp-url')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('tracker-tasks.csv')
      expect(this.href).toBe('blob:temp-url')
    })
    const blob = new Blob(['a,b'], { type: 'text/csv' })

    saveBlob(blob, 'tracker-tasks.csv')

    expect(create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:temp-url')
    expect(document.querySelector('a[download]')).toBeNull()
  })
})
```

`frontend/src/features/account/download.ts`:

```ts
/** Saves a blob through a temporary link. Nothing stays in the page afterwards. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
```

Run: `npx vitest run src/features/account/download.test.ts` → PASS.

- [ ] **Step 2: Write the failing Profile, Password and Appearance tests**

`frontend/src/features/account/components/ProfileSection.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { ProfileSection } from './ProfileSection'

const auth = vi.hoisted(() => ({
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
  updateProfile: vi.fn(),
}))
vi.mock('@/features/auth', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useSessionUser: () => auth.user,
    useUpdateProfile: () => useMutation({ mutationFn: auth.updateProfile }),
  }
})

beforeEach(() => {
  auth.updateProfile.mockReset()
})

describe('ProfileSection', () => {
  it('shows the email (read only) and the current name', () => {
    renderWithProviders(<ProfileSection />)

    expect(screen.getByLabelText('Name')).toHaveValue('Ada')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
  })

  it('saves a new name', async () => {
    auth.updateProfile.mockResolvedValue({ ...auth.user, name: 'Ada L.' })
    renderWithProviders(<ProfileSection />)

    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Ada L.')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await vi.waitFor(() => expect(auth.updateProfile).toHaveBeenCalled())
    expect(auth.updateProfile.mock.calls[0]?.[0]).toEqual({ name: 'Ada L.' })
  })

  it('does not save a blank name', async () => {
    renderWithProviders(<ProfileSection />)

    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Enter your name')).toBeInTheDocument()
    expect(auth.updateProfile).not.toHaveBeenCalled()
  })

  it('shows the server message when saving fails', async () => {
    auth.updateProfile.mockRejectedValue(new Error('Network Error'))
    renderWithProviders(<ProfileSection />)

    await userEvent.type(screen.getByLabelText('Name'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Network Error')).toBeInTheDocument()
  })
})
```

`frontend/src/features/account/components/PasswordSection.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { PasswordSection } from './PasswordSection'

const auth = vi.hoisted(() => ({ changePassword: vi.fn() }))
vi.mock('@/features/auth', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return { useChangePassword: () => useMutation({ mutationFn: auth.changePassword }) }
})

beforeEach(() => {
  auth.changePassword.mockReset()
})

async function fill(current: string, next: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('Current password'), current)
  await userEvent.type(screen.getByLabelText('New password'), next)
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('PasswordSection', () => {
  it('rejects a short new password without calling the API', async () => {
    renderWithProviders(<PasswordSection />)

    await fill('old-password-1', 'short', 'short')

    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument()
    expect(auth.changePassword).not.toHaveBeenCalled()
  })

  it('rejects a confirmation that does not match without calling the API', async () => {
    renderWithProviders(<PasswordSection />)

    await fill('old-password-1', 'a-new-passphrase', 'a-different-one')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(auth.changePassword).not.toHaveBeenCalled()
  })

  it('changes the password and clears the form', async () => {
    auth.changePassword.mockResolvedValue({ accessToken: 't', user: {} })
    renderWithProviders(<PasswordSection />)

    await fill('old-password-1', 'a-new-passphrase', 'a-new-passphrase')

    await vi.waitFor(() => expect(auth.changePassword).toHaveBeenCalled())
    expect(auth.changePassword.mock.calls[0]?.[0]).toEqual({
      currentPassword: 'old-password-1',
      newPassword: 'a-new-passphrase',
    })
    await vi.waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''))
  })

  it('tells the user when the current password is wrong', async () => {
    auth.changePassword.mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 403,
        statusText: '',
        data: { message: 'Current password is incorrect' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderWithProviders(<PasswordSection />)

    await fill('wrong-password', 'a-new-passphrase', 'a-new-passphrase')

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument()
  })
})
```

`frontend/src/features/account/components/AppearanceSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/shared/theme/themeStore'
import { AppearanceSection } from './AppearanceSection'

beforeEach(() => {
  useThemeStore.getState().setTheme('dark')
})

describe('AppearanceSection', () => {
  it('shows the current theme and switches it', async () => {
    render(<AppearanceSection />)

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }))

    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked()
  })
})
```

Run: `npx vitest run src/features/account` → FAIL (components missing).

- [ ] **Step 3: Implement the sections**

`frontend/src/features/account/components/ProfileSection.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSessionUser, useUpdateProfile } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import '../account.css'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80, 'Use at most 80 characters'),
})
type Values = z.infer<typeof schema>

export function ProfileSection() {
  const user = useSessionUser()
  const update = useUpdateProfile()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: user?.name ?? '' } })

  return (
    <Card title="Profile">
      <form
        onSubmit={handleSubmit((values) =>
          update.mutate(values, { onSuccess: () => pushToast('Profile saved', 'success') }),
        )}
        noValidate
      >
        <FormField label="Name" error={errors.name?.message}>
          <input autoComplete="name" {...register('name')} />
        </FormField>
        <FormField label="Email" hint="You cannot change your email address yet.">
          <input value={user?.email ?? ''} readOnly />
        </FormField>
        {update.isError && <p className="form-error">{getErrorMessage(update.error)}</p>}
        <Button type="submit" variant="primary" loading={update.isPending}>
          Save profile
        </Button>
      </form>
    </Card>
  )
}
```

`frontend/src/features/account/components/PasswordSection.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useChangePassword } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import '../account.css'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters'),
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })
type Values = z.infer<typeof schema>

export function PasswordSection() {
  const change = useChangePassword()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  return (
    <Card title="Password">
      <form
        onSubmit={handleSubmit(({ currentPassword, newPassword }) =>
          change.mutate(
            { currentPassword, newPassword },
            {
              onSuccess: () => {
                reset({ currentPassword: '', newPassword: '', confirm: '' })
                pushToast('Password changed. Your other devices were signed out.', 'success')
              },
            },
          ),
        )}
        noValidate
      >
        <FormField label="Current password" error={errors.currentPassword?.message}>
          <input type="password" autoComplete="current-password" {...register('currentPassword')} />
        </FormField>
        <FormField label="New password" error={errors.newPassword?.message} hint="At least 10 characters">
          <input type="password" autoComplete="new-password" {...register('newPassword')} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm?.message}>
          <input type="password" autoComplete="new-password" {...register('confirm')} />
        </FormField>
        {change.isError && <p className="form-error">{getErrorMessage(change.error)}</p>}
        <Button type="submit" variant="primary" loading={change.isPending}>
          Change password
        </Button>
      </form>
    </Card>
  )
}
```

`frontend/src/features/account/components/AppearanceSection.tsx`:

```tsx
import { useThemeStore, type Theme } from '@/shared/theme/themeStore'
import { Card } from '@/shared/ui/Card'
import '../account.css'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export function AppearanceSection() {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  return (
    <Card title="Appearance">
      <fieldset className="radio-row">
        <legend className="visually-hidden">Theme</legend>
        {THEMES.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => setTheme(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </Card>
  )
}
```

`frontend/src/features/account/account.css`:

```css
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 720px;
}
.settings h1 {
  margin: 0;
}
.form-error {
  color: var(--danger);
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}
.radio-row {
  display: flex;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  border: 0;
}
.radio-row label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.data-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.danger-zone {
  border-color: var(--danger);
}
.settings select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
```

Run: `npx vitest run src/features/account` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(account): add settings API, download helper, profile, password and appearance" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Currency, data export and delete account; the Settings page

**Files:**
- Create under `frontend/src/features/account/`: `components/CurrencySection.tsx`, `CurrencySection.test.tsx`, `DataSection.tsx`, `DataSection.test.tsx`, `DeleteAccountSection.tsx`, `DeleteAccountSection.test.tsx`, `pages/SettingsPage.tsx`, `pages/SettingsPage.test.tsx`, `routes.ts`, `index.ts`
- Modify: `frontend/src/app/navigation.ts`, `frontend/src/app/router.ts`

**Interfaces:**
- Produces (from `@/features/account`): `accountRoutes: RouteObject[]` (path `settings`).

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/account/components/CurrencySection.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as accountApi from '../api/accountApi'
import { CurrencySection } from './CurrencySection'

const auth = vi.hoisted(() => ({
  user: { id: '1', email: 'a@b.c', name: 'Ada', currency: 'USD' },
  updateSessionUser: vi.fn(),
}))
vi.mock('@/features/auth', () => ({
  useSessionUser: () => auth.user,
  updateSessionUser: auth.updateSessionUser,
}))
vi.mock('../api/accountApi')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('CurrencySection', () => {
  it('shows the current currency and explains the rule', () => {
    renderWithProviders(<CurrencySection />)

    expect(screen.getByLabelText(/^currency/i)).toHaveValue('USD')
    expect(screen.getByText(/before you add transactions or bills/i)).toBeInTheDocument()
  })

  it('does nothing when the currency has not changed', async () => {
    renderWithProviders(<CurrencySection />)

    expect(screen.getByRole('button', { name: 'Change currency' })).toBeDisabled()
  })

  it('changes the currency and updates the signed-in user', async () => {
    vi.mocked(accountApi.changeCurrency).mockResolvedValue({ user: { ...auth.user, currency: 'EUR' } })
    renderWithProviders(<CurrencySection />)

    await userEvent.selectOptions(screen.getByLabelText(/^currency/i), 'EUR')
    await userEvent.click(screen.getByRole('button', { name: 'Change currency' }))

    await vi.waitFor(() => expect(accountApi.changeCurrency).toHaveBeenCalled())
    expect(vi.mocked(accountApi.changeCurrency).mock.calls[0]?.[0]).toBe('EUR')
    await vi.waitFor(() => expect(auth.updateSessionUser).toHaveBeenCalledWith({ currency: 'EUR' }))
  })

  it('shows why the change was refused when the account already has data', async () => {
    vi.mocked(accountApi.changeCurrency).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 409,
        statusText: '',
        data: { message: 'Your currency can only be changed before you add transactions or bills' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderWithProviders(<CurrencySection />)

    await userEvent.selectOptions(screen.getByLabelText(/^currency/i), 'EUR')
    await userEvent.click(screen.getByRole('button', { name: 'Change currency' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/only be changed before you add transactions or bills/i)
    expect(auth.updateSessionUser).not.toHaveBeenCalled()
  })
})
```

`frontend/src/features/account/components/DataSection.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '@/shared/ui/toast'
import { renderWithProviders } from '@/test/render'
import * as accountApi from '../api/accountApi'
import * as download from '../download'
import { DataSection } from './DataSection'

vi.mock('../api/accountApi')
vi.mock('../download')

beforeEach(() => {
  vi.resetAllMocks()
  useToastStore.setState({ toasts: [] })
})

describe('DataSection', () => {
  it.each([
    ['Download everything (JSON)', { format: 'json' }],
    ['Transactions (CSV)', { format: 'csv', dataset: 'transactions' }],
    ['Tasks (CSV)', { format: 'csv', dataset: 'tasks' }],
    ['Bills (CSV)', { format: 'csv', dataset: 'fixed-expenses' }],
  ])('%s asks for the right export and saves the file', async (name, params) => {
    const blob = new Blob(['x'])
    vi.mocked(accountApi.downloadExport).mockResolvedValue({ blob, filename: 'file.ext' })
    renderWithProviders(<DataSection />)

    await userEvent.click(screen.getByRole('button', { name }))

    await vi.waitFor(() => expect(download.saveBlob).toHaveBeenCalledWith(blob, 'file.ext'))
    expect(vi.mocked(accountApi.downloadExport).mock.calls[0]?.[0]).toEqual(params)
  })

  it('tells the user when the download fails and does not save anything', async () => {
    vi.mocked(accountApi.downloadExport).mockRejectedValue(new Error('Network Error'))
    renderWithProviders(<DataSection />)

    await userEvent.click(screen.getByRole('button', { name: 'Tasks (CSV)' }))

    await vi.waitFor(() => expect(useToastStore.getState().toasts[0]?.message).toMatch(/could not download/i))
    expect(download.saveBlob).not.toHaveBeenCalled()
  })

  it('explains that this is also the backup', () => {
    renderWithProviders(<DataSection />)

    expect(screen.getByText(/keep a copy/i)).toBeInTheDocument()
  })
})
```

`frontend/src/features/account/components/DeleteAccountSection.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as accountApi from '../api/accountApi'
import { DeleteAccountSection } from './DeleteAccountSection'

const auth = vi.hoisted(() => ({ endSession: vi.fn() }))
vi.mock('@/features/auth', () => ({ endSession: auth.endSession }))
vi.mock('../api/accountApi')

beforeEach(() => {
  vi.resetAllMocks()
})

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  return screen.getByRole('dialog', { name: 'Delete your account' })
}

describe('DeleteAccountSection', () => {
  it('warns clearly and needs the password before anything happens', async () => {
    renderWithProviders(<DeleteAccountSection />)

    const dialog = await openDialog()
    expect(dialog).toHaveTextContent(/permanently/i)
    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }))

    expect(await screen.findByText('Enter your password to confirm')).toBeInTheDocument()
    expect(accountApi.deleteAccount).not.toHaveBeenCalled()
  })

  it('can be cancelled', async () => {
    renderWithProviders(<DeleteAccountSection />)
    await openDialog()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(accountApi.deleteAccount).not.toHaveBeenCalled()
  })

  it('shows an error and keeps the session when the password is wrong', async () => {
    vi.mocked(accountApi.deleteAccount).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 403,
        statusText: '',
        data: { message: 'Incorrect password' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderWithProviders(<DeleteAccountSection />)
    await openDialog()

    await userEvent.type(screen.getByLabelText('Your password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }))

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument()
    expect(auth.endSession).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deletes the account with the password and then ends the session', async () => {
    vi.mocked(accountApi.deleteAccount).mockResolvedValue()
    renderWithProviders(<DeleteAccountSection />)
    await openDialog()

    await userEvent.type(screen.getByLabelText('Your password'), 'correct-horse-battery')
    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }))

    await vi.waitFor(() => expect(auth.endSession).toHaveBeenCalledTimes(1))
    expect(vi.mocked(accountApi.deleteAccount).mock.calls[0]?.[0]).toBe('correct-horse-battery')
  })
})
```

`frontend/src/features/account/pages/SettingsPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import SettingsPage from './SettingsPage'

vi.mock('@/features/auth', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useSessionUser: () => ({ id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' }),
    useUpdateProfile: () => useMutation({ mutationFn: async () => ({}) }),
    useChangePassword: () => useMutation({ mutationFn: async () => ({}) }),
    updateSessionUser: vi.fn(),
    endSession: vi.fn(),
  }
})
vi.mock('../api/accountApi')

describe('SettingsPage', () => {
  it('groups profile, password, appearance, currency, data and account deletion', () => {
    renderWithProviders(<SettingsPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    for (const name of ['Profile', 'Password', 'Appearance', 'Currency', 'Your data', 'Delete account']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('keeps account deletion in a separate, clearly marked danger zone', () => {
    renderWithProviders(<SettingsPage />)

    expect(screen.getByRole('region', { name: 'Delete account' })).toHaveClass('danger-zone')
  })
})
```

Run: `npx vitest run src/features/account` → the four new files FAIL (modules missing).

- [ ] **Step 2: Implement the sections**

`frontend/src/features/account/components/CurrencySection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { updateSessionUser, useSessionUser } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { pushToast } from '@/shared/ui/toast'
import { changeCurrency } from '../api/accountApi'
import '../account.css'

const names = new Intl.DisplayNames(['en'], { type: 'currency' })
const CURRENCIES = Intl.supportedValuesOf('currency').map((code) => ({
  code,
  label: `${code} – ${names.of(code) ?? code}`,
}))

export function CurrencySection() {
  const user = useSessionUser()
  const current = user?.currency ?? 'USD'
  const [choice, setChoice] = useState(current)
  const change = useMutation({
    mutationFn: changeCurrency,
    onSuccess: ({ user: updated }) => {
      updateSessionUser({ currency: updated.currency })
      pushToast(`Currency changed to ${updated.currency}`, 'success')
    },
  })

  return (
    <Card title="Currency">
      <p className="muted">
        All your amounts are in one currency. It can only be changed before you add transactions or bills.
      </p>
      <label className="field__label">
        Currency
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          {CURRENCIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {change.isError && (
        <p className="form-error" role="alert">
          {getErrorMessage(change.error)}
        </p>
      )}
      <Button
        variant="primary"
        loading={change.isPending}
        disabled={choice === current}
        onClick={() => change.mutate(choice)}
      >
        Change currency
      </Button>
    </Card>
  )
}
```

`frontend/src/features/account/components/DataSection.tsx`:

```tsx
import { useState } from 'react'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { pushToast } from '@/shared/ui/toast'
import { downloadExport, type ExportParams } from '../api/accountApi'
import { saveBlob } from '../download'
import '../account.css'

const DOWNLOADS: { label: string; params: ExportParams }[] = [
  { label: 'Download everything (JSON)', params: { format: 'json' } },
  { label: 'Transactions (CSV)', params: { format: 'csv', dataset: 'transactions' } },
  { label: 'Tasks (CSV)', params: { format: 'csv', dataset: 'tasks' } },
  { label: 'Bills (CSV)', params: { format: 'csv', dataset: 'fixed-expenses' } },
]

export function DataSection() {
  const [busy, setBusy] = useState<string | null>(null)

  async function download(label: string, params: ExportParams) {
    setBusy(label)
    try {
      const { blob, filename } = await downloadExport(params)
      saveBlob(blob, filename)
    } catch (error) {
      pushToast(`Could not download: ${getErrorMessage(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="Your data">
      <p className="muted">
        Download your data any time. This app runs on free hosting, so it is worth keeping a copy of anything
        important.
      </p>
      <div className="data-buttons">
        {DOWNLOADS.map(({ label, params }) => (
          <Button key={label} loading={busy === label} disabled={busy !== null} onClick={() => download(label, params)}>
            {label}
          </Button>
        ))}
      </div>
    </Card>
  )
}
```

`frontend/src/features/account/components/DeleteAccountSection.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { endSession } from '@/features/auth'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { FormField } from '@/shared/ui/FormField'
import { Modal } from '@/shared/ui/Modal'
import { deleteAccount } from '../api/accountApi'
import '../account.css'

const schema = z.object({ password: z.string().min(1, 'Enter your password to confirm') })
type Values = z.infer<typeof schema>

export function DeleteAccountSection() {
  const [open, setOpen] = useState(false)
  const remove = useMutation({ mutationFn: deleteAccount, onSuccess: () => endSession() })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) })

  return (
    <Card title="Delete account" className="danger-zone">
      <p className="muted">Permanently delete your account and everything in it.</p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete my account
      </Button>

      {open && (
        <Modal title="Delete your account" onClose={() => setOpen(false)}>
          <form onSubmit={handleSubmit(({ password }) => remove.mutate(password))} noValidate>
            <p>
              This permanently deletes your tasks, transactions, categories, bills and your account. It cannot be
              undone. Download your data first if you want a copy.
            </p>
            <FormField label="Your password" error={errors.password?.message}>
              <input type="password" autoComplete="current-password" {...register('password')} />
            </FormField>
            {remove.isError && <p className="form-error">{getErrorMessage(remove.error)}</p>}
            <div className="form-actions">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="danger" loading={remove.isPending}>
                Delete forever
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  )
}
```

`Card` passes `className` to its section, which is why the danger-zone test can find the class on the region.

- [ ] **Step 3: Implement the page, routes and navigation**

`frontend/src/features/account/pages/SettingsPage.tsx`:

```tsx
import { AppearanceSection } from '../components/AppearanceSection'
import { CurrencySection } from '../components/CurrencySection'
import { DataSection } from '../components/DataSection'
import { DeleteAccountSection } from '../components/DeleteAccountSection'
import { PasswordSection } from '../components/PasswordSection'
import { ProfileSection } from '../components/ProfileSection'
import '../account.css'

export default function SettingsPage() {
  return (
    <div className="settings">
      <h1>Settings</h1>
      <ProfileSection />
      <PasswordSection />
      <AppearanceSection />
      <CurrencySection />
      <DataSection />
      <DeleteAccountSection />
    </div>
  )
}
```

`frontend/src/features/account/routes.ts`:

```ts
import type { RouteObject } from 'react-router'

export const accountRoutes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('./pages/SettingsPage')).default }),
  },
]
```

`frontend/src/features/account/index.ts`:

```ts
export { accountRoutes } from './routes'
```

In `frontend/src/app/navigation.ts` add `{ to: '/settings', label: 'Settings' }` after Bills. In `frontend/src/app/router.ts` add `import { accountRoutes } from '@/features/account'` and change the shell's children to `[...dashboardRoutes, ...taskRoutes, ...financeRoutes, ...billRoutes, ...accountRoutes]`.

Run: `npx vitest run src/features/account` → PASS.

- [ ] **Step 4: Run all checks**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(account): add currency, data export and account deletion with the settings page" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Real-browser check and milestone wrap-up

Setup: see M1 Task 13. Use two browser profiles (or one normal and one private window) to check isolation.

- [ ] **Step 1: Walk the flows**

| Do this | Expect |
|---|---|
| Open **Dashboard** for a new user | "Today", three cards with empty states and links, two empty charts |
| Add tasks (one overdue), a transaction, a bill due in 2 days | Cards: tasks due with an overdue line, net and split, the bill with "Due in 2 days" |
| Stop the backend, reload | Each card and chart shows its own error with a retry; restart and retry: they recover one by one |
| **Settings**, change the name | Top-bar name updates without a reload |
| Change password with the wrong current one | "Current password is incorrect", you stay logged in |
| Change password correctly | Success; a second browser session is signed out on its next request |
| Switch theme to Light and back | Charts and cards follow; the choice survives a reload |
| Try changing currency with data present | Refused with the explanation; use a fresh account to see it succeed and amounts use the new currency |
| Download JSON, then each CSV | Files download with dated names; open the JSON: no password or token anywhere; open the CSVs in a spreadsheet: amounts read correctly |
| Make a task titled `=1+1`, download the tasks CSV, open it | The cell shows the text `=1+1`, not `2` |
| **Delete my account** with a wrong password | Error in the dialog, still logged in |
| Delete with the right password | Sent to the login page; the old login fails; a fresh signup with the same email starts empty; the other user's data is intact |

- [ ] **Step 2: Run the complete checks and finish the branch**

```bash
(cd backend && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
git status
```

Expected: everything passes, tree clean. Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `feature/dashboard-account` into `main`.
