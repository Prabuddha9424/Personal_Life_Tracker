# Personal Life Tracker: Product Requirements Document (POC)

| | |
|---|---|
| **Status** | Approved (2026-09-24). Section 6.5 and the risks updated with verified free-tier facts the same day. |
| **Date** | 2026-09-24 |
| **Scope** | Proof of concept, hosted entirely on free tiers |
| **Related** | [`design-decisions.md`](./design-decisions.md) (layout and visual style), [`/CLAUDE.md`](../CLAUDE.md) (architecture and security rules) |

---

## 1. Purpose

A multi-tenant web app that lets a person manage **tasks** (Kanban), **personal finances** (transactions and charts) and **fixed recurring expenses** (with email reminders) in one place.

The POC has two goals, both chosen by the product owner:

1. **Real daily use by a small circle** of people (friends and family). Data safety and reliability matter.
2. **Validate as a real product.** Strangers should be able to sign up, verify their email and get value without our help, which tests real onboarding.

This is not a portfolio mock-up. Auth, tenant isolation and reminders must genuinely work.

## 2. Users

| Persona | Need |
|---|---|
| **Individual user** (primary) | Track to-dos, money in and out, and recurring bills without juggling several apps. Uses desktop and phone. |
| **Operator** (the product owner) | Keep the service running at $0, see whether people actually use it, and be able to fix problems without risking users' data. |

There are no admin or team roles in the POC. Every user sees only their own data.

## 3. Scope

### 3.1 In scope

- **Auth:** register with email verification, login, logout, forgot and reset password, change password, edit profile.
- **Tasks:** one Kanban board with fixed columns, drag-and-drop, and rich task fields.
- **Finance:** income and expense transactions, categories (preset and custom), four charts and summary cards, and CSV import.
- **Fixed expenses:** weekly, monthly and yearly recurring bills with per-expense email reminders.
- **Dashboard ("Today"):** a single overview screen across all slices.
- **Account and data:** export data, delete account.
- **UI:** sidebar layout, dark by default with a manual light/dark toggle, responsive down to phone width.
- **Hosting:** free tiers only, frontend and backend on separate hosts.

### 3.2 Out of scope (explicitly)

| Item | Why it is out |
|---|---|
| Multiple boards or custom columns | Fixed To Do / In Progress / Done covers daily use; revisit after the pilot. |
| Multi-currency or exchange-rate conversion | Needs a rate source and adds free-tier limits. One currency per user instead. |
| Web push or SMS notifications | Email only. Push needs a service worker and an extra dependency. |
| Marking a bill "paid" or auto-posting it to finance | Fixed expenses are standalone reminders. Users log actual payments in finance themselves. |
| Sharing boards, teams, or shared budgets | Single-user tenancy only. |
| Native mobile apps | The responsive web app is enough for the pilot. |
| Bank connections (Plaid-style) | Out of budget and regulatory scope. CSV import is the alternative. |
| Third-party analytics or tracking | Privacy-first; usage is measured from our own database. |

## 4. Functional requirements

Priority: **M** = must (POC fails without it), **S** = should (ship if time allows, no launch block), **C** = could.

### 4.1 Auth

| ID | Requirement | Pri |
|---|---|---|
| AUTH-1 | A visitor can register with name, email, password and currency. Password rules: at least 10 characters, checked against a short list of common passwords. | M |
| AUTH-2 | Registration sends a verification email. The account cannot log in until the email is verified. The verification token is random (`crypto.randomBytes(32)`), stored only as a SHA-256 hash, single use, and expires after 24 hours. | M |
| AUTH-3 | Registration returns the same generic response whether or not the email already exists. If it exists, the existing owner gets an "you already have an account" email instead. | S |
| AUTH-4 | A user can request a new verification email (rate limited). | M |
| AUTH-5 | Login with email and password returns a 15-minute access token in the response body (kept in memory by the client) and sets a refresh-token cookie. Bad credentials return one generic message. An unverified user gets a clear "verify your email" response only after the password was correct. | M |
| AUTH-6 | The refresh cookie is `httpOnly`, `secure`, `sameSite=Lax`, path-scoped to `/api/auth`. Refresh tokens are random, stored hashed, **rotated on every use**, and a reused (already rotated) token revokes the whole token family. Lifetime: 30 days sliding. | M |
| AUTH-7 | On app load, the client silently calls refresh to restore the session, so a page reload does not log the user out. | M |
| AUTH-8 | Logout revokes the current refresh token and clears the cookie. | M |
| AUTH-9 | Forgot password always returns the same generic message. A reset email carries a raw token; only its SHA-256 hash is stored, with a 15-minute expiry and single use. A successful reset revokes all of the user's refresh tokens. | M |
| AUTH-10 | A logged-in user can change their password (current password required). This revokes other sessions. | M |
| AUTH-11 | A logged-in user can edit their name. | M |
| AUTH-12 | Currency can be changed only while the user has no transactions and no fixed expenses (otherwise stored amounts would change meaning). See ACC-4. | C |
| AUTH-13 | Auth endpoints are rate limited (stricter on login, register, forgot-password, resend-verification). | M |

### 4.2 Tasks (Kanban)

| ID | Requirement | Pri |
|---|---|---|
| TASK-1 | Create a task with title (required), description, due date, priority (low, medium, high; default medium) and tags. | M |
| TASK-2 | The board shows three fixed columns: **To Do**, **In Progress**, **Done**. New tasks land at the top of To Do. | M |
| TASK-3 | Drag a card between columns and reorder within a column. The order persists and survives reload. Drag-and-drop is also keyboard-operable. | M |
| TASK-4 | Edit and delete a task. Delete asks for confirmation. | M |
| TASK-5 | Cards show priority marker, due date and tags. Overdue tasks (not Done, due date passed) show an overdue badge. | M |
| TASK-6 | Filter the board by tag, and search by title. | S |
| TASK-7 | Tags are free-form, normalised (trimmed, lower-cased), max 10 per task, max 30 characters each. Tag suggestions come from the user's existing tags. | S |
| TASK-8 | Optimistic UI on drag: the card moves instantly and rolls back with an error toast if the server rejects it. | S |

### 4.3 Finance

| ID | Requirement | Pri |
|---|---|---|
| FIN-1 | Create, edit and delete transactions: kind (income or expense), amount, category, date, optional note. Amount is a positive value; kind carries the sign. | M |
| FIN-2 | Money is stored as **integer minor units** with the user's currency code. The API and UI never do floating-point arithmetic on money. | M |
| FIN-3 | Each new user gets a default set of income and expense categories. Users can add, rename and delete their own categories. Deleting a category that has transactions is rejected (409) with a count, and the user must reassign or delete those transactions first. | M |
| FIN-4 | Transaction list is paginated and filterable by date range, kind and category, newest first. | M |
| FIN-5 | **Summary cards** for a selected month: total income, total expenses, net. | M |
| FIN-6 | **Spending by category** doughnut for a selected month (expenses only). | M |
| FIN-7 | **Income vs expenses** bar chart for the last 6 or 12 months. | M |
| FIN-8 | **Net balance trend** line chart over the same range. | M |
| FIN-9 | All charts have loading, empty ("add your first transaction") and error states, and are readable in both themes. Each chart has an accessible text summary or data-table alternative. | M |
| FIN-10 | **CSV import**: the browser parses a CSV, shows a preview with column mapping and validation errors per row, and the user confirms. Rows go to a bulk endpoint in batches of at most 500. Each batch is validated as a whole and accepted or rejected as a whole. Duplicate detection (same date, amount, note) warns but does not block. | S |

### 4.4 Fixed expenses and reminders

| ID | Requirement | Pri |
|---|---|---|
| FIX-1 | Create, edit, pause and delete a fixed expense: name, amount, optional label, recurrence (weekly, monthly or yearly), first due date, and "remind me N days before" (0 to 30, default 3). | M |
| FIX-2 | The app stores the next due date. Monthly and yearly recurrences use the original day-of-month and clamp to the last day of shorter months (a bill anchored on the 31st is due on 28/29 Feb, 30 Apr, and so on) without drifting. | M |
| FIX-3 | The fixed-expenses page lists expenses sorted by next due date, showing "due in N days", "due today" or "overdue". | M |
| FIX-4 | A **daily reminder job** emails each user for every active expense that is within its lead time. Each occurrence is emailed **at most once** (tracked per expense by the due date last reminded). | M |
| FIX-5 | After an occurrence's due date has passed, the job advances the expense's next due date to the next occurrence. Missed runs catch up safely: an occurrence that was never reminded gets one email, then the date advances. | M |
| FIX-6 | The reminder job is triggered by an authenticated internal HTTP endpoint (see 6.3), not by a timer inside the server. It is idempotent: running twice in a day sends no duplicates. | M |
| FIX-7 | Reminder emails contain expense name, amount, currency and due date, and a link to the app. They contain no tokens or other users' data. | M |
| FIX-8 | Users can turn reminder emails off per expense. | S |

Fixed expenses do **not** create finance transactions. The two slices are independent.

### 4.5 Dashboard ("Today")

| ID | Requirement | Pri |
|---|---|---|
| DASH-1 | Home screen after login, showing three cards: tasks due in the next 7 days (and overdue), this month's net, and the next bills due. | M |
| DASH-2 | Two compact charts below the cards: spending by category (this month) and income vs expenses (last 6 months). | S |
| DASH-3 | Every card links to its full page. Every card has loading, empty and error states, and a failure in one card does not blank the others. | M |
| DASH-4 | The dashboard reads other slices only through their public `index.ts` APIs (see section 6.1). | M |

### 4.6 Account and data ownership

| ID | Requirement | Pri |
|---|---|---|
| ACC-1 | **Export:** download all of one's data as a single JSON file, or each dataset (tasks, transactions, fixed expenses) as CSV. This is also the manual backup path, because free database tiers offer little or no automated backup. | M |
| ACC-2 | **Delete account:** requires the password, permanently removes the user and all their tasks, categories, transactions, fixed expenses and tokens, and ends the session. The operation is safe to retry if it fails half-way. | M |
| ACC-3 | Settings page groups profile, change password, theme, export and delete account. | M |
| ACC-4 | Currency editing (AUTH-12) is orchestrated here, because it needs to ask finance and fixed-expenses whether data exists. | C |

### 4.7 UI and UX

| ID | Requirement | Pri |
|---|---|---|
| UI-1 | Sidebar navigation (Dashboard, Board, Finance, Bills, Settings), collapsing to a drawer on phone width. | M |
| UI-2 | Dark theme by default, with a manual light/dark toggle in Settings remembered per browser. Both themes meet WCAG AA contrast. | M |
| UI-3 | Every data view has loading, empty and error states. Forms validate on the client and show server errors inline. | M |
| UI-4 | Responsive from 360 px wide upward. | M |
| UI-5 | Cold-start handling: while the free backend wakes up (about a minute, and longer than the 26 s proxy timeout), the UI shows a clear "waking the server, this can take up to a minute" state and retries automatically, instead of an error. | M |
| UI-6 | Feature pages are lazy-loaded with route-level `lazy`. | M |

## 5. Data model (proposed)

All tenant-owned collections carry `userId` (indexed). Money is integer minor units. Dates are stored in UTC. Field names are indicative, and the implementation plan finalises them.

| Collection (owner slice) | Key fields | Indexes |
|---|---|---|
| **users** (auth) | `email` (unique, lower-cased), `passwordHash` (`select: false`), `name`, `currency` (ISO 4217), `emailVerifiedAt`, timestamps | `email` unique |
| **emailTokens** (auth) | `userId`, `purpose` (`verify` or `reset`), `tokenHash` (SHA-256), `expiresAt`, `usedAt` | `tokenHash`, TTL on `expiresAt` |
| **refreshTokens** (auth) | `userId`, `familyId`, `tokenHash`, `expiresAt`, `revokedAt`, `replacedBy` | `tokenHash`, `{ userId, familyId }`, TTL on `expiresAt` |
| **tasks** (tasks) | `userId`, `title`, `description`, `status` (`todo`, `in_progress`, `done`), `priority`, `dueDate`, `tags[]`, `position` | `{ userId, status, position }`, `{ userId, dueDate }`, `{ userId, tags }` |
| **categories** (finance) | `userId`, `name`, `kind` (`income` or `expense`) | `{ userId, kind, name }` unique |
| **transactions** (finance) | `userId`, `kind`, `amountMinor` (int > 0), `currency`, `categoryId`, `date`, `note` | `{ userId, date: -1 }`, `{ userId, categoryId }` |
| **fixedExpenses** (fixed-expenses) | `userId`, `name`, `label`, `amountMinor`, `currency`, `recurrence` (`weekly`, `monthly`, `yearly`), `anchorDate`, `nextDueDate`, `leadDays`, `remindersEnabled`, `active`, `lastRemindedFor` | `{ userId, nextDueDate }`, `{ active, nextDueDate }` (for the job) |

Notes:

- **Task ordering:** `position` is a sortable number. A drag inserts between neighbours (midpoint), with occasional rebalancing per column. This is not money, so a number is fine.
- **Default categories** are copied into the user's own rows the first time they open categories (not at registration, so `auth` never depends on `finance`). That keeps queries simple and lets users edit freely.
- **Fixed expenses keep their own free-text `label`** rather than referencing finance categories, so the slices stay decoupled.

## 6. Architecture

### 6.1 Slices and boundaries

The vertical-slice rules in `CLAUDE.md` apply unchanged (no layer folders, no deep cross-slice imports, `shared/` never imports `features/`).

**Backend slices:** `health` (exists), `auth`, `tasks`, `finance`, `fixed-expenses`, `account`.
**Frontend slices:** `auth`, `tasks`, `finance`, `fixed-expenses`, `dashboard` (stub exists), `account`.

Cross-slice needs, all through the target slice's `index.ts`:

| Consumer | Needs | Provided by |
|---|---|---|
| `account` (export) | all of a user's data | `tasks`, `finance`, `fixed-expenses` each expose `exportForUser(userId)` |
| `account` (delete) | remove all of a user's data | each slice exposes `deleteAllForUser(userId)`; `auth` exposes `deleteUser(userId)` |
| `account` (currency) | does the user have financial data? | `finance` and `fixed-expenses` expose `hasDataForUser(userId)` |
| `dashboard` (frontend) | task, finance and bill summaries | each frontend slice exports its query hooks or components |
| `fixed-expenses` (reminders) | user's email and name | `auth` exposes `getContactForUser(userId)` |

Shared middleware (`requireAuth`, `validate`, `errorHandler`, `notFound`, rate limiters) and utilities already exist in `backend/src/shared`. A shared internal-endpoint guard for the cron secret is added there once (it has no feature knowledge).

### 6.2 API surface (indicative)

All routes are under `/api`. Every request body, param and query is validated with Zod through `validate`. Errors are `{ "message": "..." }`. Every tenant query is scoped by `{ _id, userId }`.

| Slice | Routes |
|---|---|
| auth | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password`; `GET /auth/me`; `PATCH /auth/me` |
| tasks | `GET /tasks` (filter by status, tag, search; paginated), `POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/move` (status and neighbour, for ordering) |
| finance | `GET/POST /categories`, `PATCH/DELETE /categories/:id`; `GET/POST /transactions`, `PATCH/DELETE /transactions/:id`, `POST /transactions/bulk`; `GET /finance/summary`, `/finance/by-category`, `/finance/monthly`, `/finance/trend` |
| fixed-expenses | `GET/POST /fixed-expenses`, `GET/PATCH/DELETE /fixed-expenses/:id`; internal `POST /internal/reminders/run` |
| account | `GET /account/export`, `DELETE /account`, `PATCH /account/currency` (could) |
| health | `GET /health` (exists) |

### 6.3 Reminder scheduling

Free backend hosts sleep when idle, so an in-process timer would silently miss reminders. Instead:

1. A **GitHub Actions scheduled workflow** runs once a day and calls `POST /api/internal/reminders/run` with a secret header.
2. The endpoint compares the secret using a timing-safe comparison against `CRON_SECRET` from the validated env. It is not reachable with a user token, is rate limited, and returns only counts (`sent`, `skipped`, `advanced`).
3. The workflow calls the Render URL **directly** (not through the Netlify proxy, so the 26 s proxy limit does not apply). The first request wakes the sleeping backend, and the workflow retries with back-off for up to a few minutes to cover the cold start. The daily database connection also keeps the Atlas cluster from pausing.
4. The job is **idempotent** (FIX-4, FIX-6), so retries and manual re-runs are safe.

Known limits, documented for the operator: GitHub may delay scheduled runs by several minutes, and GitHub pauses scheduled workflows in repositories with no activity for 60 days (a re-enable step goes in the runbook). If timing proves inadequate, the same endpoint can be called by a free external scheduler without code changes.

Due dates are calendar dates. The job runs at a fixed UTC time, so a user far from UTC may see a reminder a few hours early or late. See open question Q3.

### 6.4 Sessions across separate hosts

The frontend and backend live on different free hosts. To keep the refresh cookie **first-party** (so browsers do not block it), the frontend host **rewrites `/api/*` to the backend** (proxy rewrite, not redirect). The browser only ever talks to one origin, which also removes the need for cross-origin CORS in production. CORS remains locked to the whitelisted client origin as defence in depth.

Two consequences, both verified on 2026-09-24:

- Netlify proxy rewrites time out after **26 seconds**, while a cold Render start takes about a minute. The first request after idle can therefore fail with a gateway error even though the backend is waking. UI-5 covers this in the UI (wake-up state, automatic retry). An optional keep-alive ping (a free external scheduler calling `/api/health` every 10 minutes) removes most cold starts, and one always-on service fits inside Render's 750 free hours.
- Netlify's free plan allows commercial use, so it fits the product-validation goal. It has a hard monthly credit cap, which the runbook tracks.

### 6.5 Hosting (all free tier)

| Part | Target | Notes to verify at plan time |
|---|---|---|
| Frontend | **Netlify** free plan, using a `200` proxy rewrite for `/api/*` | Free plan allows commercial use, capped at 300 credits per month (hard limit). **Proxy rewrites time out after 26 s**, which is shorter than the backend cold start. |
| Backend | **Render** free web service | Spins down after 15 min without traffic, cold start about 1 minute. 750 free instance hours per month (one always-on service uses about 744). **Outbound SMTP ports 25, 465 and 587 are blocked.** |
| Database | **MongoDB Atlas** free cluster (M0) | 0.5 GB storage, 500 connections, 100 ops/s, 10 GB in and 10 GB out per rolling 7 days. **Backups cannot be enabled.** Pauses after 30 days with no connections. |
| Email | **Brevo** free plan through its SMTP relay on **port 2525** (Nodemailer, no new dependency) | 300 emails per day. The sender address must be verified in Brevo. Resend was rejected: its free plan can email arbitrary recipients only from a verified domain. |
| Scheduler | GitHub Actions cron | Delay and inactivity behaviour as in 6.3. |
| CI | GitHub Actions | Lint, typecheck and tests for both apps on every pull request. |

Verified on 2026-09-24 against each provider's documentation. Free-tier limits change often, so the runbook (milestone M6) re-checks them before deploy.

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Tenant isolation.** Every tenant query includes `userId` from the verified token, never from client input. An automated test matrix proves user A cannot read, update or delete user B's resource on every tenant endpoint (expect 404, never 403 or 200). |
| NFR-2 | **Secrets and privacy.** No password hashes, tokens or stack traces in responses. No secrets or tokens in logs. `.env` never committed, and `.env.example` kept current in each app. |
| NFR-3 | **Security headers and limits.** `helmet`, whitelisted CORS, and `express-rate-limit` on auth and internal endpoints. Passwords hashed with bcryptjs at cost 12 or higher. |
| NFR-4 | **Performance.** Warm API responses p95 under 300 ms for list and aggregate endpoints at pilot data sizes. First contentful paint under 2 s on a mid-range phone over 4G. Cold-start delay is handled by UI-5, not hidden. |
| NFR-5 | **Reliability.** Reminder job succeeds on at least 95% of scheduled days without manual action. No duplicate reminder emails. |
| NFR-6 | **Data.** Money is integer minor units. Dates are UTC. Every tenant collection has a `userId` index and compound indexes for its common filters. List endpoints are paginated and read-only queries use `.lean()`. |
| NFR-7 | **Quality gates.** `npm run lint`, `npm run typecheck` and `npm test` pass in both apps, locally and in CI. Each slice has its own tests. Backend integration tests use Supertest with an in-memory MongoDB. |
| NFR-8 | **Accessibility.** WCAG AA contrast in both themes, full keyboard operation including drag-and-drop, and labelled form controls. |
| NFR-9 | **Observability.** Structured pino logs with request IDs, and a health endpoint. There is no `console.*` anywhere. |
| NFR-10 | **Privacy of usage data.** No third-party analytics. The operator gets usage counts from the database (registered, verified, active in the last 7 days) via a script that never prints user content. |

## 8. Success criteria

The POC is successful when **all** of the following hold:

| # | Criterion | How it is measured |
|---|---|---|
| S1 | **Security:** zero known cross-tenant leaks at launch. | The NFR-1 test matrix is green in CI, and a manual review of every query. |
| S2 | **Reminders arrive on time:** due-soon emails land on the correct day for every active bill and never twice for one occurrence. | Reminder job tests (including month-end and missed-run cases), plus a two-week live log review. |
| S3 | **Real usage:** at least 5 to 10 real people (assumption, adjustable, see Q1) use it for 2 or more consecutive weeks, followed by a short feedback check-in. | Usage script (NFR-10) and the check-in. |
| S4 | **Free-tier budget holds:** the app runs for a month at $0 within every provider's limits. | Provider dashboards reviewed weekly. Limits and cold-start behaviour documented in the runbook. |

## 9. Milestones (indicative order, to be planned in detail next)

Each milestone is a vertical slice, built on its own branch with tests, lint and typecheck green before moving on.

| # | Milestone | Outcome |
|---|---|---|
| M0 | Foundation | Repo housekeeping, CI, in-memory MongoDB test setup, `.env.example` updates, frontend shell (sidebar, theme tokens, dark/light toggle). |
| M1 | Auth | Register, verify, login, refresh, logout, reset, change password. Auth pages. |
| M2 | Tasks | Board, drag-and-drop, filters, and the isolation tests for tasks. |
| M3 | Finance | Categories, transactions, aggregates and charts, and CSV import. |
| M4 | Fixed expenses | Bills CRUD, recurrence maths, reminder job and endpoint, and the GitHub Actions schedule. |
| M5 | Dashboard and account | Today dashboard, export, delete account, and settings. |
| M6 | Deploy and pilot | Free-tier deploy, proxy rewrite, runbook, then a 2-week pilot with the small circle. |

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cold start of about 1 minute on first request, versus Netlify's 26 s proxy timeout | The first call after idle can fail with a gateway error | UI-5 wake-up state with automatic retry. A lightweight `/api/health` warm-up call on app load. Optional keep-alive ping every 10 minutes. |
| Render blocks outbound SMTP ports 25, 465 and 587 on free services | Verification, reset and reminder emails silently fail if the default SMTP port is used | Use Brevo's SMTP relay on port 2525, or its HTTP API over port 443. The plan adds a startup check and a send test in the runbook. |
| Brevo requires a verified sender, and a free-mail sender address (for example Gmail) can hurt inbox placement | Emails land in spam | Verify a real sender in Brevo. If spam placement is a problem in the pilot, the only fix is a domain the operator owns, which is outside the $0 budget. |
| Free-tier terms change or forbid product use | Forced migration mid-pilot | Netlify's free plan allows commercial use (verified). Keep the backend portable (plain Node + Mongo). Re-check terms in the runbook. |
| Free email quota exhausted (Brevo: 300 per day; verification, reset and reminder emails all count) | Users cannot verify, or reminders stop | Track sends. Cap resend rates. Keep templates short. |
| GitHub cron delay or inactivity pause | Late or missed reminders | Idempotent job with catch-up (FIX-5). Runbook step to re-enable. A one-line switch to an external scheduler. |
| Atlas M0 has little or no backup | Data loss | ACC-1 export, and a documented manual export routine for the operator. Do not present the pilot as a system of record. |
| Money and date bugs (float maths, month-end, timezones) | Wrong totals or reminders | Integer minor units everywhere. Property-style tests for recurrence and clamping. |
| Scope creep into a full budgeting product | Missed pilot date | Section 3.2 is the line. Anything else goes to the post-pilot backlog. |

## 11. Open questions and assumptions

Nothing here blocks the plan. Each has a default that the plan will use unless told otherwise.

| # | Question or assumption | Default used |
|---|---|---|
| Q1 | How many real users define "success"? | 5 to 10 (assumption). |
| Q2 | Which email provider and frontend host? | **Resolved:** Netlify (frontend) and Brevo SMTP relay on port 2525 (email). See section 6.5. |
| Q3 | Reminder timing across timezones. | Fixed daily UTC run, date-only due dates. If pilot users complain, add a per-user timezone captured from the browser and an hourly job. |
| Q4 | CSV parsing library. Not in the approved stack in `CLAUDE.md`. | The plan will ask for approval before adding one, or use a small in-repo parser with tests. |
| Q5 | Password rules and the common-password list source. | 10-character minimum plus a small bundled deny-list (no new dependency). |
| Q6 | Verification token lifetime (`CLAUDE.md` specifies only the reset token). | 24 hours. |
| Q7 | Currency editing after signup (AUTH-12, ACC-4). | Rated "could". Currency is fixed at signup if it does not fit the timeline. |
| A1 | Everything lives in `/Users/samurdhi/Desktop/AI/Personal_Tracker`, which is its own git repository. Docs are in its `docs/` folder. | As written. |
