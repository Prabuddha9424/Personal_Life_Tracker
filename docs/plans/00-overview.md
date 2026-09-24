# Personal Life Tracker: Implementation Plan Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each milestone plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Read this overview first**: it holds the contracts (API shapes, cross-slice functions, test helpers, conventions) that every milestone plan relies on.

**Goal:** Build and deploy the POC described in the PRD: auth, Kanban tasks, finance with charts, fixed-expense email reminders, dashboard, and account/data tools, hosted entirely on free tiers.

**Architecture:** Vertical slices on both apps (rules in `CLAUDE.md`). Backend is Express 5 + Mongoose 9 running `.ts` directly on Node 24. Frontend is React 19 + Vite + TanStack Query. Slices talk only through each slice's `index.ts`.

**Tech Stack:** As listed in `CLAUDE.md`. The only dependency added anywhere in these plans is `mongodb-memory-server` (dev, backend; `npm view` confirmed 11.3.0 on 2026-09-24, and `CLAUDE.md` already approves it for the first DB-backed slice).

**Spec:** [`../PRD.md`](../PRD.md) (requirements, IDs like `AUTH-6` are cited in the plans) and [`../design-decisions.md`](../design-decisions.md) (layout and colour tokens).

**Stories:** [`../stories/README.md`](../stories/README.md) holds the user stories, each broken into tasks that point at the plan tasks below, with a status. Update a story's status in the same commit that changes the work.

## Milestone plans (execute in order)

| # | Plan | Branch | Delivers |
|---|---|---|---|
| M0 | [`01-foundation.md`](./01-foundation.md) | `chore/foundation` | Test DB, shared helpers, rate limits, cron guard, theme tokens, UI primitives, app shell, cold-start handling, CI |
| M1 | [`02-auth.md`](./02-auth.md) | `feature/auth-accounts` | Backend and frontend auth slices |
| M2 | [`03-tasks.md`](./03-tasks.md) | `feature/tasks-board` | Kanban board |
| M3 | [`04-finance.md`](./04-finance.md) | `feature/finance-charts` | Categories, transactions, charts, CSV import |
| M4 | [`05-fixed-expenses.md`](./05-fixed-expenses.md) | `feature/fixed-expenses-reminders` | Bills, recurrence, reminder job, scheduled workflow |
| M5 | [`06-dashboard-account.md`](./06-dashboard-account.md) | `feature/dashboard-account` | Today dashboard, export, delete account, settings |
| M6 | [`07-deploy-pilot.md`](./07-deploy-pilot.md) | `chore/deploy-pilot` | Free-tier deploy, runbook, usage script, pilot |

Each milestone ends with all three checks green in every app it touched and a branch-finish step. Do not start the next milestone before the previous one is merged.

## Global Constraints

Copied from `CLAUDE.md` and the PRD. Every task in every plan includes these implicitly.

- **Runtime and language:** Node.js 24 (`.nvmrc`), ES Modules, TypeScript `~6.0` strict in both apps. Stay on `~6.0`.
- **Backend imports:** relative imports **must include the `.ts` extension**. Only erasable TypeScript: no `enum`, `namespace`, or constructor parameter properties. Use `import type` for types (`verbatimModuleSyntax`).
- **Frontend imports:** use the `@/` alias for `src/`. Inside a slice, use relative imports.
- **Slices:** no top-level `controllers/`, `models/`, `services/`, `routes/`. Cross-slice access only through the other slice's `index.ts`. `shared/` never imports `features/`. Prefer a little duplication over a premature shared abstraction, and promote to `shared/` only when 3+ slices need it.
- **Multi-tenancy:** scope every query on tasks, finance and fixed expenses with the authenticated `userId` (`req.user.id`), including `findOne`, `updateOne`, `deleteOne` and aggregations. Look up by `{ _id, userId }`, never `_id` alone. Never trust a `userId` from the client. Index `userId` and common compound filters.
- **Validation and errors:** validate every body, param and query with Zod through `validate`. Throw `new AppError(status, message)`. Error body is `{ "message": "..." }` (validation may add `errors`). Correct status codes (201 create, 204 delete, 400/401/403/404/409/422/500).
- **Money and dates:** money is an **integer in minor units** plus a currency code, never a float. Dates are UTC. Calendar dates are `YYYY-MM-DD` strings on the wire and UTC-midnight `Date`s in Mongo.
- **Security:** bcryptjs cost ≥ 12 in a `pre('save')` hook with `select: false`. Reset and verification tokens from `crypto.randomBytes(32)`, only the SHA-256 hash stored, single use, reset expiry ≤ 15 min. Access token about 15 min, secrets only from validated env. `helmet`, whitelisted `cors`, rate limits on auth endpoints. Never return password hashes, tokens or stacks. Never log secrets. Never reveal whether an email exists. **Never store a JWT in `localStorage`**; the access token lives in memory only.
- **Lists:** paginate list endpoints and use `.lean()` for read-only queries.
- **Frontend data:** all server state through TanStack Query, with query keys co-located in the slice (`taskKeys.all`, `taskKeys.detail(id)`) and invalidated after mutations. Zustand only for client state (auth session, UI preferences). Never copy server data into Zustand or `useState`. Use the single shared `httpClient`. Forms use React Hook Form + Zod. Every data view has loading, empty and error states. Lazy-load pages with route-level `lazy`.
- **Hygiene:** no `any`, `var`, CommonJS `require`, `console.*` (backend uses the pino logger), commented-out code, or unused exports. Do not commit `.env`. Keep `.env.example` current in each app.
- **Workflow:** new branch per milestone, Conventional Commits, **never commit to `main`** (one documented exception in M0 Task 1). Add or update tests in the same slice for every behaviour change. After writing code run `npm run lint`, `npm run typecheck`, `npm test` in the affected app and fix every failure. Do not finish a task with any of them failing.
- **Dependencies:** do not add packages outside the `CLAUDE.md` list without asking. Run `npm view <pkg> version` before adding one.
- **Formatting:** Prettier config in each app (no semicolons, single quotes, trailing commas, width 100). Run `npm run format` if lint or `format:check` complains.

## Conventions used by every plan

### Commands

```bash
# backend (from Personal_Tracker/backend)
npm run lint && npm run typecheck && npm test
npx vitest run src/features/auth/auth.session.test.ts     # one file
npx vitest run -t "rotates the refresh cookie"           # one test by name

# frontend (from Personal_Tracker/frontend)
npm run lint && npm run typecheck && npm test
npx vitest run src/features/auth/pages/LoginPage.test.tsx
```

The first backend test run that touches MongoDB downloads a `mongod` binary (about 100 MB) into `node_modules/.cache`. It needs network access once and can take a few minutes. Every DB test file has a 120 s hook timeout for that reason.

### Commit format

Every commit uses a Conventional Commits subject and ends with the attribution trailer:

```bash
git commit -m "feat(tasks): add board columns" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### TDD rhythm

For each behaviour: write the failing test, run it and **see it fail for the right reason**, write the minimal code, run it and see it pass, commit. Steps in the plans follow this order. Test titles in the plans are the behaviour, so keep them.

### Test helpers created in M0 (used by every later plan)

| Helper | File | Use |
|---|---|---|
| `startTestDb()`, `clearTestDb()`, `stopTestDb()` | `backend/src/test/mongo.ts` | In-memory MongoDB per test file: `beforeAll(startTestDb)`, `afterEach(clearTestDb)`, `afterAll(stopTestDb)` |
| `testUser()` | `backend/src/test/auth.ts` | Returns `{ id, headers }` with a valid access token for a random user id. `requireAuth` only verifies the JWT, so tenant slices need no real user row |
| `renderWithProviders(ui, options?)` | `frontend/src/test/render.tsx` | Renders inside a fresh `QueryClientProvider` and `MemoryRouter` |

### Mocking mail in tests

Any backend test that can send mail starts with this (Vitest hoists it):

```ts
vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))
```

## Cross-slice contracts

These exact names and signatures are relied on by later plans. If a plan must change one, it updates this table in the same commit.

### Backend public APIs (`features/<slice>/index.ts`)

| Slice | Export | Signature |
|---|---|---|
| `auth` | `authRouter` | Express `Router`, mounted at `/api/auth` |
| `auth` | `UserProfile` | `{ id: string; email: string; name: string; currency: string }` |
| `auth` | `getUserProfile` | `(userId: string) => Promise<UserProfile \| null>` |
| `auth` | `verifyPassword` | `(userId: string, password: string) => Promise<boolean>` |
| `auth` | `setUserCurrency` | `(userId: string, currency: string) => Promise<void>` |
| `auth` | `deleteUser` | `(userId: string) => Promise<void>` (user, email tokens, refresh tokens) |
| `auth` | `clearRefreshCookie` | `(res: Response) => void` |
| `tasks` | `taskRouter` | mounted at `/api/tasks` |
| `tasks` | `TaskDto` | see API contract below |
| `tasks` | `exportTasksForUser` | `(userId: string) => Promise<TaskDto[]>` |
| `tasks` | `deleteTasksForUser` | `(userId: string) => Promise<void>` |
| `finance` | `financeRouter` | mounted at `/api`; internally scopes `requireAuth` to `/categories`, `/transactions`, `/finance` |
| `finance` | `CategoryDto`, `TransactionDto` | see API contract below |
| `finance` | `exportFinanceForUser` | `(userId: string) => Promise<{ categories: CategoryDto[]; transactions: TransactionDto[] }>` |
| `finance` | `deleteFinanceForUser` | `(userId: string) => Promise<void>` |
| `finance` | `hasFinanceDataForUser` | `(userId: string) => Promise<boolean>` |
| `fixed-expenses` | `fixedExpenseRouter` | mounted at `/api/fixed-expenses` |
| `fixed-expenses` | `reminderRouter` | mounted at `/api/internal/reminders` (cron secret, not user auth) |
| `fixed-expenses` | `FixedExpenseDto` | see API contract below |
| `fixed-expenses` | `exportFixedExpensesForUser` | `(userId: string) => Promise<FixedExpenseDto[]>` |
| `fixed-expenses` | `deleteFixedExpensesForUser` | `(userId: string) => Promise<void>` |
| `fixed-expenses` | `hasFixedExpensesForUser` | `(userId: string) => Promise<boolean>` |
| `account` | `accountRouter` | mounted at `/api/account` |

### Shared backend helpers (created in M0)

| Helper | File | Signature |
|---|---|---|
| `createRateLimiter`, `authRateLimiter`, `mailRateLimiter`, `internalRateLimiter` | `shared/middleware/rateLimiters.ts` | `createRateLimiter({ windowMs, limit, skip? })` |
| `requireCronSecret` | `shared/middleware/requireCronSecret.ts` | `RequestHandler`, checks header `x-cron-secret` against `env.CRON_SECRET` |
| `objectIdSchema`, `idParamsSchema`, `paginationQuerySchema`, `calendarDateSchema`, `monthSchema`, `toSkip`, `paginated` | `shared/validation/requestSchemas.ts` | see M0 Task 5 |
| `parseCalendarDate`, `formatCalendarDate`, `todayUtc`, `addDays`, `currentMonth`, `shiftMonth`, `monthRange` | `shared/dates/calendarDate.ts` | see M0 Task 5 |

### Frontend public APIs

| Slice | Exports |
|---|---|
| `auth` | `authRoutes`, `ProtectedRoute`, `SessionGate`, `UserMenu`, `useSessionUser`, `updateSessionUser`, `endSession`, `useChangePassword`, `useUpdateProfile`, `initAuth` |
| `tasks` | `taskRoutes`, `useDueSoonTasks` |
| `finance` | `financeRoutes`, `useMonthSummary`, `SpendingByCategoryChart`, `IncomeExpenseChart` |
| `fixed-expenses` | `billRoutes`, `useUpcomingBills`, `dueLabel` |
| `dashboard` | `dashboardRoutes` |
| `account` | `accountRoutes` |

### Shared frontend helpers (created in M0)

`@/shared/lib/money` (`minorUnitDigits`, `toMinorUnits`, `minorToMajor`, `formatMinorUnits`; `formatMinorForInput` is added in M3), `@/shared/lib/dates` (`todayIso`, `addDaysIso`, `daysBetween`, `formatDate`, `currentMonthIso`, `shiftMonthIso`, `formatMonth`), `@/shared/ui/*` (`Button`, `Card`, `Spinner`, `LoadingState`, `EmptyState`, `ErrorState`, `FormField`, `Modal`, `ToastHost`, `pushToast`), `@/shared/theme/themeStore`.

## API contract (all routes under `/api`)

Pagination: `?page` (1-based, default 1) and `?limit` (default 50, max 200). Paginated responses are `{ items, page, limit, total }`. Calendar dates are `YYYY-MM-DD`. Ids are 24-char hex strings. Money fields end in `Minor`.

**Auth** (`UserDto = { id, email, name, currency }`)

| Method and path | Body | Success |
|---|---|---|
| `POST /auth/register` | `{ name, email, password, currency }` | `202 { message }` (same whether or not the email exists) |
| `POST /auth/verify-email` | `{ token }` | `200 { message }` |
| `POST /auth/resend-verification` | `{ email }` | `202 { message }` |
| `POST /auth/login` | `{ email, password }` | `200 { accessToken, user }` + refresh cookie |
| `POST /auth/refresh` | none (cookie) | `200 { accessToken, user }` + rotated cookie |
| `POST /auth/logout` | none (cookie) | `204`, cookie cleared |
| `POST /auth/forgot-password` | `{ email }` | `202 { message }` |
| `POST /auth/reset-password` | `{ token, password }` | `200 { message }` |
| `POST /auth/change-password` (auth) | `{ currentPassword, newPassword }` | `200 { accessToken, user }` + new cookie |
| `GET /auth/me` (auth) | | `200 { user }` |
| `PATCH /auth/me` (auth) | `{ name }` | `200 { user }` |

**Tasks** (`TaskDto = { id, title, description, status: 'todo'|'in_progress'|'done', priority: 'low'|'medium'|'high', dueDate: string|null, tags: string[], position: number, createdAt, updatedAt }`)

| Method and path | Notes |
|---|---|
| `GET /tasks` | query `status`, `tag`, `q`, `dueBefore` (date), `open` (`true` = not done), `sort` (`position` default or `dueDate`), `page`, `limit` |
| `POST /tasks` | `{ title, description?, priority?, dueDate?, tags?, status? }` → `201 TaskDto`, new task goes to the top of its column |
| `GET /tasks/tags` | `{ tags: string[] }` (the user's distinct tags) |
| `GET/PATCH/DELETE /tasks/:id` | PATCH takes `title`, `description`, `priority`, `dueDate` (null clears), `tags`; DELETE → 204 |
| `POST /tasks/:id/move` | `{ status, afterId?, beforeId? }` (`afterId` = card that will sit directly above, `beforeId` = card directly below) → `200 TaskDto` |

**Finance** (`CategoryDto = { id, name, kind: 'income'|'expense' }`, `TransactionDto = { id, kind, amountMinor, currency, categoryId, date, note }`)

| Method and path | Notes |
|---|---|
| `GET /categories` | query `kind?` → `{ items: CategoryDto[] }` (creates the default set on first use) |
| `POST /categories` | `{ name, kind }` → 201 |
| `PATCH /categories/:id` | `{ name }` |
| `DELETE /categories/:id` | 204, or `409` with the transaction count in the message |
| `GET /transactions` | query `from`, `to`, `kind`, `categoryId`, `page`, `limit`, newest first |
| `POST /transactions` | `{ kind, amountMinor, categoryId, date, note? }` → 201. Category kind must equal transaction kind |
| `PATCH/DELETE /transactions/:id` | |
| `POST /transactions/bulk` | `{ rows: [...create bodies] }` max 500, all or nothing → `201 { created }` |
| `GET /finance/summary?month=YYYY-MM` | `{ month, currency, incomeMinor, expenseMinor, netMinor }` |
| `GET /finance/by-category?month=YYYY-MM` | `{ month, currency, items: [{ categoryId, name, totalMinor }] }` expenses only, largest first |
| `GET /finance/monthly?months=6\|12&to=YYYY-MM` | `{ currency, items: [{ month, incomeMinor, expenseMinor, netMinor }] }` oldest first, zero-filled |
| `GET /finance/trend?months=6\|12&to=YYYY-MM` | `{ currency, openingMinor, items: [{ month, balanceMinor }] }` |

**Fixed expenses** (`FixedExpenseDto = { id, name, label, amountMinor, currency, recurrence: 'weekly'|'monthly'|'yearly', anchorDate, nextDueDate, leadDays, remindersEnabled, active }`)

| Method and path | Notes |
|---|---|
| `GET /fixed-expenses` | sorted by `nextDueDate` ascending, paginated |
| `POST /fixed-expenses` | `{ name, label?, amountMinor, recurrence, anchorDate, leadDays?, remindersEnabled? }` → 201 |
| `GET/PATCH/DELETE /fixed-expenses/:id` | PATCH also takes `active` |
| `POST /internal/reminders/run` | header `x-cron-secret` → `200 { sent, skipped, advanced, failed }` |

**Account**

| Method and path | Notes |
|---|---|
| `GET /account/export?format=json` | full JSON download |
| `GET /account/export?format=csv&dataset=tasks\|transactions\|fixed-expenses` | one CSV download |
| `PATCH /account/currency` | `{ currency }`, `409` once the user has transactions or fixed expenses |
| `DELETE /account` | `{ password }` → 204 |

## Decisions made while planning (deviations from the PRD text)

| Topic | Decision | Why |
|---|---|---|
| Default categories | Created lazily on the first `GET /categories`, not at registration | Keeps `auth` from depending on `finance`. A unique index makes concurrent first calls safe. |
| User password field | Named `password` (holds the bcrypt hash, `select: false`) | Matches the `CLAUDE.md` wording. |
| bcrypt cost in tests | `4` when `NODE_ENV=test`, `12` otherwise | Keeps the suite fast. Production and development use 12. |
| Refresh reuse | A rotated token reused within 10 s returns 401 without revoking the family | Two tabs restoring at the same moment must not log the user out. Reuse after 10 s revokes the whole family (AUTH-6). |
| Auto-retry of failed requests | Only `GET`/`HEAD` are retried on 502/503/504 or no response | Retrying a `POST` that may have reached a waking server could create duplicates. The app warms the backend on load instead (M0 Task 9). |
| Cron job and tenancy | The reminder job is the one cross-tenant reader, guarded by the cron secret. Every write it makes is filtered by `{ _id, userId }` | It has no user context by design. |
| Deleted-account tokens | A deleted user's access token stays valid up to 15 minutes because `requireAuth` does not query the database | Accepted risk. Finance and reminders look the user up and fail with 401. The frontend clears the session immediately. |
| Reading cookies | A 12-line parser in the `auth` slice | `cookie-parser` is not in the approved stack. |
| CSV parsing (PRD Q4) | A small in-repo parser with tests, in the `finance` frontend slice | Avoids adding a dependency. |
| Theme storage | The theme preference is in `localStorage` | It is a UI preference. Only JWTs are forbidden there. |

## Review Focus (whole project)

The inputs and conditions the PRD implies but no single requirement spells out. Each is pinned by a test in the plan that owns the code (named in brackets).

1. **Two users, one browser.** After logout or account switch, the second user must never see the first user's cached data. [M1: query cache cleared on logout and on failed refresh]
2. **Token in the URL.** Reset and verification links land on a page that must strip the token from the address bar and never reveal whether it was valid for a given email. [M1]
3. **Month-end recurrence.** Bills on the 29th, 30th and 31st and on 29 Feb must land on the last day of shorter months without drifting on later occurrences. [M4]
4. **Reminder job run twice, or after missed days.** No duplicate email, and a bill missed for days gets exactly one email. [M4]
5. **Drag and drop while another tab changed the board.** A move whose neighbour was deleted or belongs to another status must fail cleanly and the board must refetch. [M2]
6. **Currencies with no decimals or three decimals.** JPY and BHD amounts must round-trip through form, storage and chart without float errors. [M0 and M3]
7. **Aggregations must not leak across users.** A `$match` with a string `userId` silently matches nothing, and one without `userId` matches everyone. [M3]
8. **CSV injection on export.** Cells starting with `=`, `+`, `-` or `@` must be neutralised. [M5]
9. **Imported CSV edge cases.** Quoted commas, doubled quotes, CRLF, a BOM, blank lines, a header-only file. [M3]
10. **Server asleep on first click.** The UI must show the waking state instead of an error, and must not double-submit a form. [M0]
