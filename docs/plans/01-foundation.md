# M0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first.

**Goal:** Put in place everything the feature slices share: an in-memory database for tests, environment and rate-limit foundations, a cron-secret guard, shared validation and date helpers, dark-first theme tokens, UI primitives, the app shell, cold-start handling and CI.

**Architecture:** Additions go into `backend/src/shared` and `frontend/src/shared` (no feature knowledge) plus `frontend/src/app` for the shell. No feature slice is added. The existing `health` and `dashboard` slices stay as they are, apart from one markup tweak.

**Tech Stack:** Express 5, Vitest 5, Supertest, mongodb-memory-server 11.3.0 (new, dev only), Zod 4, React 19, React Router 8, Zustand 5, Axios.

**Spec:** [`../PRD.md`](../PRD.md) sections 4.7 (UI-1 to UI-6), 6.3, 6.4, NFR-1 to NFR-9. [`../design-decisions.md`](../design-decisions.md) sections 2 and 3.

## Global Constraints

- Backend relative imports include `.ts`; erasable TypeScript only; `import type` for types.
- Frontend imports use `@/` for `src/`; relative imports inside a slice.
- `shared/` must never import from `features/`.
- No `any`, no `console.*`, no commented-out code, no unused exports.
- Run `npm run lint`, `npm run typecheck`, `npm test` in each app you touch; all must pass.
- Commits: Conventional Commits, each ending with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Never commit to `main`.
- Colour tokens (dark): `--bg #0f1420`, `--surface #1a2133`, `--border #2a3350`, `--text #e6eaf5`, `--text-muted #8b95b3`, `--accent #9fb0ff`, `--danger #ff8a94`, `--positive #4ade80`.
- Both themes must meet WCAG AA contrast (NFR-8).

## Review Focus

1. **Server asleep on first click (UI-5).** A `GET` that gets 502/503/504 or no response is retried and the banner shows; a `POST` is never auto-retried. [Task 10 tests]
2. **Cron secret comparison.** Missing header, wrong header, and a header of a different length must all be rejected the same way, and the right one accepted. [Task 4 tests]
3. **Invalid page and id inputs.** `page=0`, `limit=201`, an id that is 24 characters but not hex, and `2026-02-30` must all be rejected. [Task 5 tests]
4. **Currencies with 0 and 3 decimals.** `500` JPY and `1.234` BHD parse to integers; `5.5` JPY is rejected rather than rounded. [Task 11 tests]
5. **Theme storage unavailable.** The app must still render dark if `localStorage` throws (private windows). [Task 7 implementation, `try/catch` around every access]

---

### Task 1: Baseline commit and the foundation branch

**Files:**
- Modify: none (git only)

**Interfaces:**
- Produces: a `main` branch pointing at the baseline commit and the working branch `chore/foundation`, which all M0 tasks commit to.

`Personal_Tracker` is now its own git repository with no commits, and `CLAUDE.md` forbids committing to `main`. To respect that, the baseline commit is made on the milestone branch and `main` is then created at that commit, so nothing is ever committed directly on `main`.

- [x] **Step 1: Confirm the repository state**

Run from `/Users/samurdhi/Desktop/AI/Personal_Tracker`:

```bash
git rev-parse --show-toplevel
git status --short
git log --oneline 2>&1 | head -1
```

Expected: the toplevel is `.../Personal_Tracker`; status lists `.editorconfig`, `.gitignore`, `.nvmrc`, `CLAUDE.md`, `backend/`, `docs/`, `frontend/`; the log says `does not have any commits yet`.

- [x] **Step 2: Prove the baseline is green before touching anything**

```bash
(cd backend && npm run lint && npm run typecheck && npm test)
(cd frontend && npm run lint && npm run typecheck && npm test)
```

Expected: both apps pass. Backend shows 2 tests (the health endpoint and the unknown-route 404), frontend shows 1 test (DashboardPage). If anything fails, stop and fix it in a separate `fix/` branch before continuing.

- [x] **Step 3: Check that nothing sensitive or generated will be committed**

```bash
git add -A --dry-run | grep -E 'node_modules|dist/|\.env$|\.superpowers' || echo "clean"
```

Expected: `clean`. (`.gitignore` already covers `node_modules`, `dist`, `.env*` except `.env.example`, and `.superpowers/`.)

- [x] **Step 4: Create the branch, make the baseline commit, then create `main` at it**

```bash
git checkout -b chore/foundation
git add -A
git commit -m "chore: baseline scaffold, PRD and implementation plans" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git branch main
git branch --list
```

Expected: `* chore/foundation` and `main` both listed, and `git log --oneline` shows the one baseline commit.

---

### Task 2: In-memory test database and test-token helper

**Files:**
- Create: `backend/src/test/mongo.ts`, `backend/src/test/mongo.test.ts`, `backend/src/test/auth.ts`, `backend/src/test/auth.test.ts`
- Modify: `backend/package.json` (dev dependency), `backend/vitest.config.ts`, `backend/tsconfig.build.json`

**Interfaces:**
- Produces: `startTestDb(): Promise<void>`, `clearTestDb(): Promise<void>`, `stopTestDb(): Promise<void>`, `testUser(): { id: string; headers: { Authorization: string } }`.

- [x] **Step 1: Confirm the version, then install**

```bash
cd backend
npm view mongodb-memory-server version
npm install --save-dev mongodb-memory-server
```

Expected: `11.3.0` (or a newer stable if published); `package.json` lists it under `devDependencies`.

- [x] **Step 2: Write the failing test for the database helper**

Create `backend/src/test/mongo.test.ts`:

```ts
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearTestDb, startTestDb, stopTestDb } from './mongo.ts'

describe('test database helper', () => {
  beforeAll(startTestDb)
  afterAll(stopTestDb)

  it('connects to an in-memory MongoDB', () => {
    expect(mongoose.connection.readyState).toBe(mongoose.ConnectionStates.connected)
  })

  it('clears every collection', async () => {
    const items = mongoose.connection.collection('items')
    await items.insertOne({ name: 'a' })

    await clearTestDb()

    expect(await items.countDocuments()).toBe(0)
  })
})
```

- [x] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/test/mongo.test.ts`
Expected: FAIL, `Failed to resolve import "./mongo.ts"`.

- [x] **Step 4: Update the Vitest config (timeouts, cron secret) and the build config**

Replace `backend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The first run downloads a mongod binary, so hooks get a long timeout.
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/life-tracker-test',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      CRON_SECRET: 'test-cron-secret-that-is-at-least-32-chars',
      CLIENT_URL: 'http://localhost:5173',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_USER: 'test',
      SMTP_PASS: 'test',
      MAIL_FROM: 'Life Tracker <no-reply@example.com>',
    },
  },
})
```

Replace `backend/tsconfig.build.json` so test-only files never reach `dist/`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/*.test-helpers.ts", "src/test"]
}
```

(`CRON_SECRET` is required by the env schema added in Task 3. Adding it to the test env now is harmless.)

- [x] **Step 5: Write the helper**

Create `backend/src/test/mongo.ts`:

```ts
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let server: MongoMemoryServer | undefined

/** Starts an in-memory MongoDB and connects the default mongoose connection to it. */
export async function startTestDb(): Promise<void> {
  server = await MongoMemoryServer.create()
  await mongoose.connect(server.getUri('test'))
  // Models are registered on import, so this builds their unique and TTL indexes.
  await mongoose.syncIndexes()
}

/** Empties every collection but keeps the indexes. Call in afterEach. */
export async function clearTestDb(): Promise<void> {
  const collections = (await mongoose.connection.db?.collections()) ?? []
  await Promise.all(collections.map((collection) => collection.deleteMany({})))
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect()
  await server?.stop()
  server = undefined
}
```

- [x] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run src/test/mongo.test.ts`
Expected: PASS, 2 tests. The first run downloads `mongod`, which can take a few minutes.

- [x] **Step 7: Write the failing test for the token helper**

Create `backend/src/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verifyAccessToken } from '../shared/auth/token.ts'
import { testUser } from './auth.ts'

describe('testUser', () => {
  it('returns a bearer header whose token verifies to the user id', () => {
    const user = testUser()

    const token = user.headers.Authorization.replace('Bearer ', '')

    expect(verifyAccessToken(token)?.sub).toBe(user.id)
  })

  it('returns a different id every time', () => {
    expect(testUser().id).not.toBe(testUser().id)
  })
})
```

Run: `npx vitest run src/test/auth.test.ts` → FAIL (`./auth.ts` missing).

- [x] **Step 8: Implement it**

Create `backend/src/test/auth.ts`:

```ts
import { Types } from 'mongoose'
import { signAccessToken } from '../shared/auth/token.ts'

/**
 * A fake tenant. `requireAuth` only verifies the JWT, so tenant-slice tests do not
 * need a real user row: a random ObjectId with a signed token is enough.
 */
export function testUser(): { id: string; headers: { Authorization: string } } {
  const id = new Types.ObjectId().toString()
  return { id, headers: { Authorization: `Bearer ${signAccessToken(id)}` } }
}
```

Run: `npx vitest run src/test/auth.test.ts` → PASS.

- [x] **Step 9: Run all checks**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass (health tests still report `database: 'down'` because they never connect).

- [x] **Step 10: Commit**

```bash
git add backend
git commit -m "chore(backend): add in-memory MongoDB and test-token helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Environment, proxy hops and rate limiters

**Files:**
- Modify: `backend/src/shared/config/env.ts`, `backend/src/app.ts`, `backend/src/shared/middleware/rateLimiters.ts`, `backend/.env.example`
- Test: `backend/src/shared/middleware/rateLimiters.test.ts`

**Interfaces:**
- Produces: `env.REFRESH_TOKEN_TTL_DAYS: number`, `env.TRUST_PROXY_HOPS: number`, `env.CRON_SECRET: string`; `createRateLimiter({ windowMs, limit, skip? })`; `authRateLimiter` (20 per 15 min), `mailRateLimiter` (5 per hour), `internalRateLimiter` (30 per hour). The three named limiters do nothing when `NODE_ENV=test`.

Why `TRUST_PROXY_HOPS`: in production a request passes through Netlify's proxy and then Render's load balancer. With the current hard-coded `1` hop, Express would see Netlify's address for every user, so every user would share one rate-limit bucket. The hop count becomes configuration and is verified in M6.

- [ ] **Step 1: Write the failing rate-limiter test**

Create `backend/src/shared/middleware/rateLimiters.test.ts`:

```ts
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimiters.ts'

describe('createRateLimiter', () => {
  it('answers 429 in the standard error format once the limit is exceeded', async () => {
    const app = express()
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }))
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    const res = await request(app).get('/')

    expect(res.status).toBe(429)
    expect(res.body).toEqual({ message: 'Too many requests, please try again later' })
  })
})
```

Run: `npx vitest run src/shared/middleware/rateLimiters.test.ts` → FAIL (`createRateLimiter` is not exported).

- [ ] **Step 2: Implement the limiter factory**

Replace `backend/src/shared/middleware/rateLimiters.ts`:

```ts
import { rateLimit, type Options } from 'express-rate-limit'
import { env } from '../config/env.ts'

interface LimiterOptions {
  windowMs: number
  limit: number
  skip?: Options['skip']
}

export function createRateLimiter({ windowMs, limit, skip }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later' },
  })
}

// Supertest sends every request from one address, so the app-level limiters are off in tests.
// createRateLimiter itself is tested directly above.
const skipInTests = () => env.NODE_ENV === 'test'

/** Login, refresh, verify, reset and other auth endpoints. */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: skipInTests,
})

/** Endpoints that send an email (register, resend, forgot password). */
export const mailRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skip: skipInTests,
})

/** Internal endpoints called by the scheduler. */
export const internalRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  skip: skipInTests,
})
```

Run the test → PASS.

- [ ] **Step 3: Add the new environment variables**

In `backend/src/shared/config/env.ts`, inside `envSchema`, add after `JWT_EXPIRES_IN`:

```ts
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),
```

In `backend/src/app.ts` replace `app.set('trust proxy', 1)` with:

```ts
app.set('trust proxy', env.TRUST_PROXY_HOPS)
```

Append to `backend/.env.example`:

```
REFRESH_TOKEN_TTL_DAYS=30
# Reverse proxies in front of the API. Local dev: 0. On Render behind Netlify's proxy this is verified in M6.
TRUST_PROXY_HOPS=1
# Shared secret for the scheduled reminder job. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CRON_SECRET=change-me-to-a-long-random-string-of-at-least-32-chars
```

Also replace the `SMTP_HOST` and `SMTP_PORT` lines' surrounding comment so it reads: local development uses a catcher on port 1025 (for example Mailpit); production uses the Brevo SMTP relay `smtp-relay.brevo.com` on port 2525 because Render's free tier blocks ports 25, 465 and 587.

- [ ] **Step 4: Run all checks**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass. (`.env.example` is not loaded by tests; the test env comes from `vitest.config.ts`.)

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): add configurable proxy hops, refresh TTL, cron secret and rate limiters" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Cron secret guard

**Files:**
- Create: `backend/src/shared/middleware/requireCronSecret.ts`
- Test: `backend/src/shared/middleware/requireCronSecret.test.ts`

**Interfaces:**
- Consumes: `env.CRON_SECRET`, `AppError`, `errorHandler`.
- Produces: `requireCronSecret: RequestHandler`, which reads the `x-cron-secret` header and throws `AppError(401, 'Not authorized')` unless it equals `env.CRON_SECRET`.

- [ ] **Step 1: Write the failing test**

```ts
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { env } from '../config/env.ts'
import { errorHandler } from './errorHandler.ts'
import { requireCronSecret } from './requireCronSecret.ts'

function buildApp() {
  const app = express()
  app.post('/run', requireCronSecret, (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireCronSecret', () => {
  it('accepts the configured secret', async () => {
    const res = await request(buildApp()).post('/run').set('x-cron-secret', env.CRON_SECRET)

    expect(res.status).toBe(200)
  })

  it.each([
    ['a missing header', undefined],
    ['a wrong secret of the same length', 'x'.repeat(env.CRON_SECRET.length)],
    ['a secret of a different length', 'short'],
    ['an empty secret', ''],
  ])('rejects %s with 401', async (_name, value) => {
    const req = request(buildApp()).post('/run')
    const res = await (value === undefined ? req : req.set('x-cron-secret', value))

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ message: 'Not authorized' })
  })
})
```

Run: `npx vitest run src/shared/middleware/requireCronSecret.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { env } from '../config/env.ts'
import { AppError } from '../errors/AppError.ts'

const digest = (value: string) => createHash('sha256').update(value).digest()

/** Guards endpoints that only the scheduler may call. Not tied to any user. */
export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const provided = req.get('x-cron-secret') ?? ''
  // Hashing first gives both sides the same length, so timingSafeEqual never throws or leaks it.
  if (!timingSafeEqual(digest(provided), digest(env.CRON_SECRET))) {
    throw new AppError(401, 'Not authorized')
  }
  next()
}
```

Run the test → PASS (5 cases).

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(backend): add cron secret guard for internal endpoints" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Shared request schemas and calendar-date helpers

**Files:**
- Create: `backend/src/shared/validation/requestSchemas.ts`, `backend/src/shared/validation/requestSchemas.test.ts`, `backend/src/shared/dates/calendarDate.ts`, `backend/src/shared/dates/calendarDate.test.ts`

**Interfaces:**
- Produces (validation): `objectIdSchema`, `idParamsSchema` (`{ id }`), `paginationQuerySchema` (`{ page = 1, limit = 50 }`, `limit` max 200), `calendarDateSchema` (`YYYY-MM-DD`, real dates only), `monthSchema` (`YYYY-MM`), `Paginated<T>`, `toSkip({ page, limit }): number`, `paginated(items, total, { page, limit }): Paginated<T>`.
- Produces (dates): `parseCalendarDate(value: string): Date` (UTC midnight), `formatCalendarDate(date: Date): string`, `todayUtc(now?: Date): Date`, `addDays(date: Date, days: number): Date`, `currentMonth(now?: Date): string`, `shiftMonth(month: string, delta: number): string`, `monthRange(month: string): { start: Date; end: Date }` (half-open `[start, end)`).

Three slices need these (tasks, finance, fixed expenses), which meets the promote-to-`shared/` threshold.

- [ ] **Step 1: Write the failing validation tests**

Create `backend/src/shared/validation/requestSchemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  calendarDateSchema,
  idParamsSchema,
  monthSchema,
  objectIdSchema,
  paginated,
  paginationQuerySchema,
  toSkip,
} from './requestSchemas.ts'

describe('objectIdSchema', () => {
  it('accepts 24 hex characters', () => {
    expect(objectIdSchema.safeParse('65f1c2a4b3d4e5f6a7b8c9d0').success).toBe(true)
  })

  it.each(['', 'abc', '65f1c2a4b3d4e5f6a7b8c9d', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'rejects %j',
    (value) => {
      expect(objectIdSchema.safeParse(value).success).toBe(false)
    },
  )

  it('is usable as route params', () => {
    expect(idParamsSchema.parse({ id: '65f1c2a4b3d4e5f6a7b8c9d0' })).toEqual({
      id: '65f1c2a4b3d4e5f6a7b8c9d0',
    })
  })
})

describe('paginationQuerySchema', () => {
  it('defaults to page 1 and limit 50', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 50 })
  })

  it('coerces query strings', () => {
    expect(paginationQuerySchema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 })
  })

  it.each([{ page: '0' }, { page: '-1' }, { limit: '0' }, { limit: '201' }, { page: '1.5' }])(
    'rejects %j',
    (query) => {
      expect(paginationQuerySchema.safeParse(query).success).toBe(false)
    },
  )

  it('computes skip and the response shape', () => {
    expect(toSkip({ page: 3, limit: 20 })).toBe(40)
    expect(paginated(['a'], 41, { page: 3, limit: 20 })).toEqual({
      items: ['a'],
      page: 3,
      limit: 20,
      total: 41,
    })
  })
})

describe('calendarDateSchema', () => {
  it.each(['2026-02-28', '2028-02-29', '2026-12-31'])('accepts %s', (value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(true)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-2-3', '26-02-03', '2026-02-28T00:00:00Z', ''])(
    'rejects %j',
    (value) => {
      expect(calendarDateSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('monthSchema', () => {
  it('accepts YYYY-MM only', () => {
    expect(monthSchema.safeParse('2026-09').success).toBe(true)
    expect(monthSchema.safeParse('2026-13').success).toBe(false)
    expect(monthSchema.safeParse('2026-9').success).toBe(false)
    expect(monthSchema.safeParse('2026-09-01').success).toBe(false)
  })
})
```

Run: `npx vitest run src/shared/validation` → FAIL (module missing).

- [ ] **Step 2: Implement the schemas**

Create `backend/src/shared/validation/requestSchemas.ts`:

```ts
import { z } from 'zod'

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

export const idParamsSchema = z.object({ id: objectIdSchema })

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** A real calendar date as `YYYY-MM-DD`. */
export const calendarDateSchema = z.iso.date()

/** A calendar month as `YYYY-MM`. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM')

interface PageArgs {
  page: number
  limit: number
}

export interface Paginated<T> {
  items: T[]
  page: number
  limit: number
  total: number
}

export function toSkip({ page, limit }: PageArgs): number {
  return (page - 1) * limit
}

export function paginated<T>(items: T[], total: number, { page, limit }: PageArgs): Paginated<T> {
  return { items, page, limit, total }
}
```

Run the tests → PASS.

- [ ] **Step 3: Write the failing date tests**

Create `backend/src/shared/dates/calendarDate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addDays,
  currentMonth,
  formatCalendarDate,
  monthRange,
  parseCalendarDate,
  shiftMonth,
  todayUtc,
} from './calendarDate.ts'

describe('calendar dates', () => {
  it('parses to UTC midnight and formats back', () => {
    const date = parseCalendarDate('2026-09-24')

    expect(date.toISOString()).toBe('2026-09-24T00:00:00.000Z')
    expect(formatCalendarDate(date)).toBe('2026-09-24')
  })

  it('todayUtc drops the time and uses the UTC day', () => {
    const now = new Date('2026-09-24T23:59:59.000Z')

    expect(formatCalendarDate(todayUtc(now))).toBe('2026-09-24')
  })

  it('adds days across month and year ends', () => {
    expect(formatCalendarDate(addDays(parseCalendarDate('2026-12-31'), 1))).toBe('2027-01-01')
    expect(formatCalendarDate(addDays(parseCalendarDate('2026-03-01'), -1))).toBe('2026-02-28')
  })
})

describe('months', () => {
  it('reports the current UTC month', () => {
    expect(currentMonth(new Date('2026-09-24T12:00:00.000Z'))).toBe('2026-09')
  })

  it.each([
    ['2026-09', 1, '2026-10'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -14, '2025-01'],
    ['2026-09', 0, '2026-09'],
  ])('shifts %s by %i to %s', (month, delta, expected) => {
    expect(shiftMonth(month, delta)).toBe(expected)
  })

  it('returns a half-open range for a month', () => {
    const { start, end } = monthRange('2026-02')

    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })
})
```

Run: `npx vitest run src/shared/dates` → FAIL.

- [ ] **Step 4: Implement the date helpers**

Create `backend/src/shared/dates/calendarDate.ts`:

```ts
const DAY_MS = 86_400_000

/** `YYYY-MM-DD` to a Date at UTC midnight. Validate the string first (calendarDateSchema). */
export function parseCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** The UTC calendar day of `now`, at midnight. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

export function currentMonth(now: Date = new Date()): string {
  return formatCalendarDate(now).slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  const shiftedYear = Math.floor(index / 12)
  const shiftedMonth = (index % 12) + 1
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`
}

/** `[start, end)` for a `YYYY-MM` month, both at UTC midnight. */
export function monthRange(month: string): { start: Date; end: Date } {
  return {
    start: parseCalendarDate(`${month}-01`),
    end: parseCalendarDate(`${shiftMonth(month, 1)}-01`),
  }
}
```

Run the date tests → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(backend): add shared request schemas and calendar-date helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Design tokens and UI primitives

**Files:**
- Modify: `frontend/src/index.css` (replace the whole file), `frontend/src/main.tsx`
- Create: `frontend/src/shared/ui/ui.css`, `Button.tsx`, `Button.test.tsx`, `Spinner.tsx`, `Card.tsx`, `StateViews.tsx`, `StateViews.test.tsx`, `FormField.tsx`, `FormField.test.tsx` (all under `frontend/src/shared/ui/`)

**Interfaces:**
- Produces: `Button({ variant?: 'primary'|'secondary'|'danger'|'ghost', loading?, ...buttonProps })`, `Spinner({ size?: 'sm'|'md' })`, `Card({ title?, children, className? })`, `LoadingState({ label? })`, `EmptyState({ title, description?, action? })`, `ErrorState({ message?, onRetry? })`, `FormField({ label, error?, hint?, children })`.
- Produces: CSS custom properties `--bg --surface --surface-2 --border --text --text-muted --accent --accent-strong --on-accent --danger --danger-bg --positive --warning --chart-1 … --chart-6` for both `[data-theme='dark']` (default) and `[data-theme='light']`.

- [ ] **Step 1: Write the failing Button test**

Create `frontend/src/shared/ui/Button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('calls onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled and busy while loading, so it cannot be double-submitted', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })

    await userEvent.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Cancel</Button>)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button')
  })
})
```

Run (from `frontend`): `npx vitest run src/shared/ui/Button.test.tsx` → FAIL (module missing).

- [ ] **Step 2: Implement Spinner and Button**

`frontend/src/shared/ui/Spinner.tsx`:

```tsx
interface SpinnerProps {
  size?: 'sm' | 'md'
}

/** Decorative. Pair it with visible text (LoadingState) for screen readers. */
export function Spinner({ size = 'md' }: SpinnerProps) {
  return <span className={`spinner spinner--${size}`} aria-hidden="true" />
}
```

`frontend/src/shared/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={['btn', `btn--${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}
```

Run the Button test → PASS (3 tests).

- [ ] **Step 3: Write failing tests for the state views and FormField**

`frontend/src/shared/ui/StateViews.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, LoadingState } from './StateViews'

describe('state views', () => {
  it('LoadingState announces its label', () => {
    render(<LoadingState label="Loading tasks…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…')
  })

  it('EmptyState shows title, description and action', () => {
    render(<EmptyState title="No tasks yet" description="Add your first task." action={<button>Add</button>} />)

    expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument()
    expect(screen.getByText('Add your first task.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('ErrorState is an alert and offers a retry only when given a handler', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorState message="Could not load" onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<ErrorState message="Could not load" />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
```

`frontend/src/shared/ui/FormField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'

describe('FormField', () => {
  it('associates the label with its control', () => {
    render(
      <FormField label="Email">
        <input />
      </FormField>,
    )

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows the error as an alert and hides the hint while there is an error', () => {
    const { rerender } = render(
      <FormField label="Email" hint="We never share it">
        <input />
      </FormField>,
    )
    expect(screen.getByText('We never share it')).toBeInTheDocument()

    rerender(
      <FormField label="Email" hint="We never share it" error="Enter a valid email">
        <input />
      </FormField>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email')
    expect(screen.queryByText('We never share it')).not.toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/shared/ui` → FAIL for the two new files.

- [ ] **Step 4: Implement Card, StateViews and FormField**

`frontend/src/shared/ui/Card.tsx`:

```tsx
import type { ReactNode } from 'react'

interface CardProps {
  title?: string
  children: ReactNode
  className?: string
}

export function Card({ title, children, className }: CardProps) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  )
}
```

`frontend/src/shared/ui/StateViews.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Button } from './Button'
import { Spinner } from './Spinner'

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  )
}

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function ErrorState({ message = 'Something went wrong', onRetry }: ErrorStateProps) {
  return (
    <div className="state state--error" role="alert">
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  )
}
```

`frontend/src/shared/ui/FormField.tsx`:

```tsx
import type { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  error?: string
  hint?: string
  children: ReactNode
}

/** Wraps a control in its label. Pass the input, select or textarea as children. */
export function FormField({ label, error, hint, children }: FormFieldProps) {
  return (
    <div className="field">
      <label className="field__label">
        <span>{label}</span>
        {children}
      </label>
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
```

Run: `npx vitest run src/shared/ui` → PASS.

- [ ] **Step 5: Write the design tokens and base styles**

Replace the whole of `frontend/src/index.css`:

```css
:root,
:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #0f1420;
  --surface: #1a2133;
  --surface-2: #232c4a;
  --border: #2a3350;
  --text: #e6eaf5;
  --text-muted: #8b95b3;
  --accent: #9fb0ff;
  --accent-strong: #4f63e8;
  --on-accent: #ffffff;
  --danger: #ff8a94;
  --danger-bg: #4a1d24;
  --positive: #4ade80;
  --warning: #fbbf24;
  --chart-1: #9fb0ff;
  --chart-2: #4ade80;
  --chart-3: #fbbf24;
  --chart-4: #f472b6;
  --chart-5: #38bdf8;
  --chart-6: #fb923c;
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-2: #eef1f8;
  --border: #d8dde8;
  --text: #1c2430;
  --text-muted: #566079;
  --accent: #3538cd;
  --accent-strong: #3b4fd8;
  --on-accent: #ffffff;
  --danger: #b42318;
  --danger-bg: #fde8e8;
  --positive: #067647;
  --warning: #93370d;
  --chart-1: #3538cd;
  --chart-2: #067647;
  --chart-3: #b45309;
  --chart-4: #be185d;
  --chart-5: #0369a1;
  --chart-6: #c2410c;
}

:root {
  --radius: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  line-height: 1.5;
}

h1,
h2,
h3 {
  margin: 0 0 var(--space-3);
  line-height: 1.25;
}

a {
  color: var(--accent);
}

.muted {
  color: var(--text-muted);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Write the primitive styles**

Create `frontend/src/shared/ui/ui.css`:

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn--primary {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: var(--on-accent);
}
.btn--danger {
  background: var(--danger-bg);
  border-color: var(--danger);
  color: var(--danger);
}
.btn--ghost {
  background: transparent;
  border-color: transparent;
}

.spinner {
  display: inline-block;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner--sm {
  width: 14px;
  height: 14px;
}
.spinner--md {
  width: 24px;
  height: 24px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
}
.card__title {
  font-size: 1rem;
  color: var(--text-muted);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
  text-align: center;
}
.state--error {
  color: var(--danger);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}
.field__label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 0.9rem;
  color: var(--text-muted);
}
.field input,
.field select,
.field textarea {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
.field__hint {
  font-size: 0.8rem;
  color: var(--text-muted);
}
.field__error {
  font-size: 0.85rem;
  color: var(--danger);
}
```

In `frontend/src/main.tsx`, add `import '@/shared/ui/ui.css'` below `import './index.css'`.

- [ ] **Step 7: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): add design tokens and UI primitives" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Expected: all pass.

---

### Task 7: Theme store and toggle

**Files:**
- Create: `frontend/public/theme-init.js`, `frontend/src/shared/theme/themeStore.ts`, `frontend/src/shared/theme/themeStore.test.ts`, `frontend/src/shared/theme/ThemeToggle.tsx`, `frontend/src/shared/theme/ThemeToggle.test.tsx`
- Modify: `frontend/index.html`, `frontend/src/main.tsx`

**Interfaces:**
- Produces: `useThemeStore` (Zustand: `{ theme: 'dark' | 'light'; setTheme(theme); toggleTheme() }`), `initTheme(): void`, `ThemeToggle()`, `type Theme`.

The theme is a UI preference, so `localStorage` is allowed (only JWTs are forbidden there). Every storage access is wrapped because private windows can throw (Review Focus 5). The tiny `theme-init.js` runs before first paint to avoid a flash of the wrong theme; it is a separate file, not inline, so a strict Content-Security-Policy in M6 does not need `unsafe-inline` for scripts.

- [ ] **Step 1: Write the failing tests**

`frontend/src/shared/theme/themeStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from './themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.getState().setTheme('dark')
  })

  it('applies the theme to the document and persists it', () => {
    useThemeStore.getState().setTheme('light')

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('toggles between dark and light', () => {
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('still switches when storage throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    expect(() => useThemeStore.getState().setTheme('light')).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')

    setItem.mockRestore()
  })
})
```

`frontend/src/shared/theme/ThemeToggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from './ThemeToggle'
import { useThemeStore } from './themeStore'

describe('ThemeToggle', () => {
  beforeEach(() => {
    useThemeStore.getState().setTheme('dark')
  })

  it('offers the opposite theme and switches on click', async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    expect(useThemeStore.getState().theme).toBe('light')
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/shared/theme` → FAIL.

- [ ] **Step 2: Implement the store**

`frontend/src/shared/theme/themeStore.ts`:

```ts
import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'theme'

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage can be unavailable (private windows). The theme still applies for this visit.
    }
    applyTheme(theme)
    set({ theme })
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))

export function initTheme(): void {
  applyTheme(useThemeStore.getState().theme)
}
```

`frontend/src/shared/theme/ThemeToggle.tsx`:

```tsx
import { Button } from '@/shared/ui/Button'
import { useThemeStore } from './themeStore'

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <Button variant="ghost" onClick={toggleTheme} aria-label={`Switch to ${next} theme`}>
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </Button>
  )
}
```

Run the theme tests → PASS.

- [ ] **Step 3: Apply the theme before first paint and at start-up**

Create `frontend/public/theme-init.js`:

```js
try {
  document.documentElement.dataset.theme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
} catch {
  document.documentElement.dataset.theme = 'dark'
}
```

In `frontend/index.html`, inside `<head>` before the `<title>`, add:

```html
    <meta name="color-scheme" content="dark light" />
    <script src="/theme-init.js"></script>
```

In `frontend/src/main.tsx` add `import { initTheme } from '@/shared/theme/themeStore'` and call `initTheme()` on the line before `createRoot(...)`. (This keeps the store and the document in sync even if the static script was blocked.)

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): add dark-first theme store and toggle" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Modal and toasts

**Files:**
- Create: `frontend/src/shared/ui/Modal.tsx`, `Modal.test.tsx`, `toast.ts`, `toast.test.ts`, `ToastHost.tsx`, `ToastHost.test.tsx`
- Modify: `frontend/src/shared/ui/ui.css` (append)

**Interfaces:**
- Produces: `Modal({ title, onClose, children })` (role `dialog`, Escape and backdrop close, focus moves in and returns, Tab is trapped), `pushToast(message, kind?: 'info'|'success'|'error', durationMs?): void`, `useToastStore`, `ToastHost()`.

- [ ] **Step 1: Write the failing Modal test**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('is an accessible dialog with a title', () => {
    render(
      <Modal title="New task" onClose={() => {}}>
        <input aria-label="Title" />
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'New task' })).toHaveAttribute('aria-modal', 'true')
  })

  it('moves focus to the first field and gives it back on close', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { unmount } = render(
      <Modal title="New task" onClose={() => {}}>
        <input aria-label="Title" />
      </Modal>,
    )
    expect(screen.getByLabelText('Title')).toHaveFocus()

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('closes on Escape and on a backdrop click, but not on a click inside', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="New task" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Inside' }))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Tab inside the dialog', async () => {
    render(
      <Modal title="New task" onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    )
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()

    await userEvent.tab()

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
  })
})
```

Run: `npx vitest run src/shared/ui/Modal.test.tsx` → FAIL.

Note on the last test: the close button is the first focusable element in DOM order (it sits in the header), so tabbing from the last body button wraps to it.

- [ ] **Step 2: Implement Modal**

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'input, select, textarea, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? dialogRef.current
    target?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = items[0]
      const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn--ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div ref={bodyRef} className="modal__body">
          {children}
        </div>
      </div>
    </div>
  )
}
```

Run the Modal tests → PASS. (If the backdrop-click assertion fails because `userEvent.click` dispatches `mousedown` on the backdrop element itself, it should pass; the handler checks `event.target === event.currentTarget`.)

- [ ] **Step 3: Write the failing toast tests**

`frontend/src/shared/ui/toast.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushToast, useToastStore } from './toast'

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a toast and removes it after its duration', () => {
    pushToast('Saved', 'success', 3000)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(2999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps toasts independent', () => {
    pushToast('One', 'info', 1000)
    pushToast('Two', 'info', 5000)

    vi.advanceTimersByTime(1000)

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Two'])
  })
})
```

`frontend/src/shared/ui/ToastHost.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastHost } from './ToastHost'
import { useToastStore } from './toast'

describe('ToastHost', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('renders errors as alerts and other toasts as status messages', () => {
    render(<ToastHost />)

    act(() => {
      useToastStore.setState({
        toasts: [
          { id: 1, message: 'Saved', kind: 'success' },
          { id: 2, message: 'Could not save', kind: 'error' },
        ],
      })
    })

    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
  })
})
```

Run → FAIL.

- [ ] **Step 4: Implement toasts**

`frontend/src/shared/ui/toast.ts`:

```ts
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: Toast[]
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export function pushToast(message: string, kind: ToastKind = 'info', durationMs = 5000): void {
  const id = nextId++
  useToastStore.setState((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), durationMs)
}
```

`frontend/src/shared/ui/ToastHost.tsx`:

```tsx
import { useToastStore } from './toast'

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{toast.message}</span>
          <button type="button" className="btn btn--ghost" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Append the styles**

Append to `frontend/src/shared/ui/ui.css`:

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgb(0 0 0 / 0.6);
}
.modal {
  width: min(560px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-4);
}
.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toasts {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: min(360px, calc(100vw - 2 * var(--space-4)));
}
.toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.toast--error {
  border-color: var(--danger);
  color: var(--danger);
}
.toast--success {
  border-color: var(--positive);
}
```

- [ ] **Step 6: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): add modal dialog and toast notifications" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: App shell, router structure and the provider test helper

**Files:**
- Create: `frontend/src/test/render.tsx`, `frontend/src/app/navigation.ts`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.test.tsx`, `frontend/src/app/shell.css`
- Modify: `frontend/src/app/RootLayout.tsx`, `frontend/src/app/router.ts`, `frontend/src/features/dashboard/pages/DashboardPage.tsx`, `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `ThemeToggle`, `ToastHost`.
- Produces: `renderWithProviders(ui, { route? })` returning the RTL result plus `queryClient`; `NavItem = { to: string; label: string }`; `navItems: NavItem[]` (each milestone appends its own entry); `AppShell()` (sidebar, top bar, `<Outlet />`).

- [ ] **Step 1: Create the shared test helper**

`frontend/src/test/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'

interface Options {
  route?: string
}

/** Renders inside a fresh QueryClient (no retries) and a MemoryRouter. */
export function renderWithProviders(ui: ReactElement, { route = '/' }: Options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}
```

- [ ] **Step 2: Write the failing AppShell test**

`frontend/src/app/AppShell.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { AppShell } from './AppShell'

function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<p>Home content</p>} />
      </Route>
    </Routes>,
  )
}

describe('AppShell', () => {
  it('shows the navigation, marks the current page and renders the route content', () => {
    renderShell()

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Home content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument()
  })

  it('opens and closes the navigation drawer on small screens', async () => {
    renderShell()
    const sidebar = screen.getByLabelText('Primary')
    expect(sidebar).not.toHaveClass('is-open')

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(sidebar).toHaveClass('is-open')

    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(sidebar).not.toHaveClass('is-open')
  })
})
```

Run: `npx vitest run src/app` → FAIL (`./AppShell` missing).

- [ ] **Step 3: Implement navigation and the shell**

`frontend/src/app/navigation.ts`:

```ts
export interface NavItem {
  to: string
  label: string
}

/** Each milestone appends its own entry when its pages exist. */
export const navItems: NavItem[] = [{ to: '/', label: 'Dashboard' }]
```

`frontend/src/app/AppShell.tsx`:

```tsx
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { ThemeToggle } from '@/shared/theme/ThemeToggle'
import { navItems } from './navigation'
import './shell.css'

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="shell">
      <aside className={`shell__sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Primary">
        <div className="shell__brand">Tracker</div>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `shell__link${isActive ? ' is-active' : ''}`}
              onClick={() => setDrawerOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {drawerOpen && <div className="shell__scrim" onClick={() => setDrawerOpen(false)} />}
      <div className="shell__main">
        <header className="shell__topbar">
          <button
            type="button"
            className="btn btn--ghost shell__menu"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            ☰
          </button>
          <div className="shell__actions">
            <ThemeToggle />
          </div>
        </header>
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
```

`frontend/src/app/shell.css`:

```css
.shell {
  display: flex;
  min-height: 100vh;
}
.shell__sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: var(--space-4);
  background: var(--surface);
  border-right: 1px solid var(--border);
}
.shell__brand {
  margin-bottom: var(--space-6);
  font-weight: 700;
}
.shell__sidebar nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.shell__link {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: var(--text-muted);
  text-decoration: none;
}
.shell__link:hover {
  background: var(--surface-2);
}
.shell__link.is-active {
  background: var(--surface-2);
  color: var(--text);
}
.shell__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.shell__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.shell__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}
.shell__content {
  flex: 1;
  padding: var(--space-6) var(--space-4);
}
.shell__menu,
.shell__scrim {
  display: none;
}

@media (max-width: 800px) {
  .shell__sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }
  .shell__sidebar.is-open {
    transform: translateX(0);
  }
  .shell__scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgb(0 0 0 / 0.5);
  }
  .shell__menu {
    display: inline-flex;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shell__sidebar {
    transition: none;
  }
}
```

Run `npx vitest run src/app` → PASS.

- [ ] **Step 4: Wire the shell into the router and root layout**

`frontend/src/app/RootLayout.tsx`:

```tsx
import { Outlet } from 'react-router'
import { ToastHost } from '@/shared/ui/ToastHost'

export function RootLayout() {
  return (
    <>
      <Outlet />
      <ToastHost />
    </>
  )
}
```

`frontend/src/app/router.ts`:

```ts
import { createBrowserRouter } from 'react-router'
import { dashboardRoutes } from '@/features/dashboard'
import { NotFoundPage } from '@/shared/ui/NotFoundPage'
import { AppShell } from './AppShell'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { Component: AppShell, children: [...dashboardRoutes] },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
```

In `frontend/src/features/dashboard/pages/DashboardPage.tsx` replace `<main>` and `</main>` with `<section>` and `</section>` (the shell already provides the single `<main>` landmark). The existing dashboard test still passes.

- [ ] **Step 5: Run all checks, look at it, commit**

```bash
npm run lint && npm run typecheck && npm test
npm run dev
```

Open `http://localhost:5173`. Expected: dark background, a "Tracker" sidebar with one "Dashboard" link, the heading "Personal Life Tracker", and a working theme toggle in the top bar. Narrow the window below 800 px and confirm the hamburger opens the drawer. Stop the dev server, then:

```bash
git add frontend
git commit -m "feat(frontend): add app shell with sidebar navigation and drawer" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Cold-start handling (UI-5)

**Files:**
- Create: `frontend/src/shared/api/axios-augment.d.ts`, `frontend/src/shared/api/serverStatus.ts`, `frontend/src/shared/api/coldStartRetry.ts`, `frontend/src/shared/api/coldStartRetry.test.ts`, `frontend/src/shared/api/warmUp.ts`, `frontend/src/shared/ui/ServerStatusBanner.tsx`, `frontend/src/shared/ui/ServerStatusBanner.test.tsx`
- Modify: `frontend/src/shared/api/httpClient.ts`, `frontend/src/app/RootLayout.tsx`, `frontend/src/shared/ui/ui.css` (append)

**Interfaces:**
- Produces: `useServerStatus` (`{ waking: boolean; setWaking(waking) }`), `installColdStartRetry(client, { maxAttempts = 5, delayMs = 5000 }?)`, `warmUpServer(): Promise<void>`, `ServerStatusBanner()`. `AxiosRequestConfig` gains `coldStartAttempt?: number`.

Behaviour (PRD UI-5, 6.4): the free backend sleeps and takes about a minute to wake, while Netlify's proxy gives up after 26 s, so the first call after idle often answers 504. `GET` and `HEAD` requests that get 502/503/504 or no response at all are retried automatically (with a "waking the server" banner). Other methods are **never** retried, because a `POST` may already have reached the waking server and a retry could create a duplicate.

- [ ] **Step 1: Write the failing tests**

`frontend/src/shared/api/coldStartRetry.test.ts`:

```ts
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { installColdStartRetry } from './coldStartRetry'
import { useServerStatus } from './serverStatus'

function gatewayError(config: InternalAxiosRequestConfig, status: number) {
  return new AxiosError('Gateway error', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config,
  })
}

/** An axios client whose server fails `failures` times with `status`, then answers 200. */
function buildClient(failures: number, status: number, options = { delayMs: 0, maxAttempts: 5 }) {
  const state = { calls: 0 }
  const client = axios.create({
    adapter: async (config) => {
      state.calls += 1
      if (state.calls <= failures) throw gatewayError(config, status)
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
    },
  })
  installColdStartRetry(client, options)
  return { client, state }
}

describe('installColdStartRetry', () => {
  beforeEach(() => {
    useServerStatus.getState().setWaking(false)
  })

  it('retries a GET that gets a gateway timeout until the server answers', async () => {
    const { client, state } = buildClient(2, 504)

    const response = await client.get('/health')

    expect(response.data).toEqual({ ok: true })
    expect(state.calls).toBe(3)
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('shows the waking state while it waits between attempts', async () => {
    const seen: boolean[] = []
    const unsubscribe = useServerStatus.subscribe((state) => seen.push(state.waking))
    const { client } = buildClient(1, 503)

    await client.get('/health')
    unsubscribe()

    expect(seen).toContain(true)
    expect(seen.at(-1)).toBe(false)
  })

  it('never retries a POST', async () => {
    const { client, state } = buildClient(5, 504)

    await expect(client.post('/tasks', {})).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(1)
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('does not retry client errors', async () => {
    const { client, state } = buildClient(5, 404)

    await expect(client.get('/missing')).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(1)
  })

  it('gives up after the maximum number of retries', async () => {
    const { client, state } = buildClient(99, 502, { delayMs: 0, maxAttempts: 2 })

    await expect(client.get('/health')).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(3)
    expect(useServerStatus.getState().waking).toBe(false)
  })
})
```

`frontend/src/shared/ui/ServerStatusBanner.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useServerStatus } from '@/shared/api/serverStatus'
import { ServerStatusBanner } from './ServerStatusBanner'

describe('ServerStatusBanner', () => {
  beforeEach(() => {
    useServerStatus.getState().setWaking(false)
  })

  it('appears only while the server is waking up', () => {
    render(<ServerStatusBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => useServerStatus.getState().setWaking(true))

    expect(screen.getByRole('status')).toHaveTextContent(/waking up the server/i)
  })
})
```

Run: `npx vitest run src/shared` → the two new files FAIL (modules missing).

- [ ] **Step 2: Implement the store, the type augmentation and the retry interceptor**

`frontend/src/shared/api/axios-augment.d.ts`:

```ts
import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** How many cold-start retries this request has used. Set by installColdStartRetry. */
    coldStartAttempt?: number
  }
}
```

`frontend/src/shared/api/serverStatus.ts`:

```ts
import { create } from 'zustand'

interface ServerStatusState {
  waking: boolean
  setWaking: (waking: boolean) => void
}

export const useServerStatus = create<ServerStatusState>((set) => ({
  waking: false,
  setWaking: (waking) => set({ waking }),
}))
```

`frontend/src/shared/api/coldStartRetry.ts`:

```ts
import axios, { type AxiosInstance } from 'axios'
import { useServerStatus } from './serverStatus'

const GATEWAY_STATUSES = new Set([502, 503, 504])
const SAFE_METHODS = new Set(['get', 'head'])

interface ColdStartOptions {
  maxAttempts?: number
  delayMs?: number
}

/** True when the failure looks like a sleeping server: a gateway error, or no response at all. */
function looksLikeWakingServer(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.code === 'ERR_CANCELED') return false
  return !error.response || GATEWAY_STATUSES.has(error.response.status)
}

/**
 * Retries safe requests while a free-tier backend wakes up. Only GET and HEAD are retried:
 * a POST that timed out may already have been processed, and repeating it could duplicate data.
 */
export function installColdStartRetry(
  client: AxiosInstance,
  { maxAttempts = 5, delayMs = 5000 }: ColdStartOptions = {},
): void {
  const { setWaking } = useServerStatus.getState()

  client.interceptors.response.use(
    (response) => {
      setWaking(false)
      return response
    },
    async (error: unknown) => {
      const config = axios.isAxiosError(error) ? error.config : undefined
      const attempt = config?.coldStartAttempt ?? 0
      const method = config?.method?.toLowerCase() ?? ''

      if (config && SAFE_METHODS.has(method) && looksLikeWakingServer(error) && attempt < maxAttempts) {
        config.coldStartAttempt = attempt + 1
        setWaking(true)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        return client.request(config)
      }

      setWaking(false)
      return Promise.reject(error)
    },
  )
}
```

Run `npx vitest run src/shared/api` → PASS (5 tests).

- [ ] **Step 3: Install it on the shared client and add the warm-up call**

In `frontend/src/shared/api/httpClient.ts` add `import { installColdStartRetry } from './coldStartRetry'` at the top and, directly after the existing `httpClient.interceptors.response.use(...)` block, add:

```ts
installColdStartRetry(httpClient)
```

Create `frontend/src/shared/api/warmUp.ts`:

```ts
import { httpClient } from './httpClient'

/**
 * Pings the health endpoint so a sleeping free-tier backend starts waking before the user acts.
 * Failures are ignored: individual requests report their own errors.
 */
export async function warmUpServer(): Promise<void> {
  try {
    await httpClient.get('/health', { timeout: 30_000 })
  } catch {
    // Nothing to do. The request that follows will surface a real error if the server is down.
  }
}
```

(`warmUpServer` is consumed by the auth slice's `SessionGate` in M1. It is exported here because it belongs with the client it wraps.)

- [ ] **Step 4: Implement the banner**

`frontend/src/shared/ui/ServerStatusBanner.tsx`:

```tsx
import { useServerStatus } from '@/shared/api/serverStatus'

export function ServerStatusBanner() {
  const waking = useServerStatus((state) => state.waking)
  if (!waking) return null

  return (
    <div className="server-banner" role="status">
      Waking up the server. This can take up to a minute the first time…
    </div>
  )
}
```

Append to `frontend/src/shared/ui/ui.css`:

```css
.server-banner {
  position: sticky;
  top: 0;
  z-index: 70;
  padding: var(--space-2) var(--space-4);
  background: var(--surface-2);
  border-bottom: 1px solid var(--warning);
  text-align: center;
}
```

In `frontend/src/app/RootLayout.tsx`, add `import { ServerStatusBanner } from '@/shared/ui/ServerStatusBanner'` and render `<ServerStatusBanner />` as the first child inside the fragment (above `<Outlet />`).

Run: `npx vitest run src/shared/ui/ServerStatusBanner.test.tsx` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): retry safe requests while the free backend wakes up" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Money and date helpers

**Files:**
- Create: `frontend/src/shared/lib/money.ts`, `money.test.ts`, `dates.ts`, `dates.test.ts` (under `frontend/src/shared/lib/`)

**Interfaces:**
- Produces (money): `minorUnitDigits(currency: string): number`, `toMinorUnits(input: string, currency: string): number | null` (integer or `null` when invalid, never rounds), `formatMinorUnits(minor: number, currency: string, locale?: string): string`, `minorToMajor(minor: number, currency: string): number` (**display and chart plotting only**).
- Produces (dates, all `YYYY-MM-DD` / `YYYY-MM` strings): `todayIso(now?: Date): string` (the user's local calendar day), `addDaysIso(iso, days)`, `daysBetween(fromIso, toIso): number`, `formatDate(iso, locale?)`, `currentMonthIso(now?)`, `shiftMonthIso(month, delta)`, `formatMonth(month, locale?)`.

Three slices (finance, fixed-expenses, dashboard) need these, so they live in `shared/`.

- [ ] **Step 1: Write the failing money tests**

```ts
import { describe, expect, it } from 'vitest'
import { formatMinorUnits, minorToMajor, minorUnitDigits, toMinorUnits } from './money'

describe('minorUnitDigits', () => {
  it.each([
    ['USD', 2],
    ['JPY', 0],
    ['BHD', 3],
  ])('%s has %i decimals', (currency, digits) => {
    expect(minorUnitDigits(currency)).toBe(digits)
  })
})

describe('toMinorUnits', () => {
  it.each([
    ['12.34', 'USD', 1234],
    ['12', 'USD', 1200],
    ['0.05', 'USD', 5],
    ['1,234.50', 'USD', 123450],
    ['12,50', 'USD', 1250],
    ['1.234,50', 'EUR', 123450],
    ['12.345.678,9', 'EUR', 1234567890],
    ['500', 'JPY', 500],
    ['1.234', 'BHD', 1234],
    [' 7.5 ', 'USD', 750],
  ])('parses %j in %s to %i', (input, currency, expected) => {
    expect(toMinorUnits(input, currency)).toBe(expected)
  })

  it.each([
    ['', 'USD'],
    ['abc', 'USD'],
    ['-5', 'USD'],
    ['1.234', 'USD'],
    ['5.5', 'JPY'],
    ['1.2345', 'BHD'],
    ['12.3.4', 'USD'],
    ['9007199254740993', 'USD'],
  ])('rejects %j in %s instead of rounding it', (input, currency) => {
    expect(toMinorUnits(input, currency)).toBeNull()
  })

  it('never produces a float', () => {
    expect(Number.isInteger(toMinorUnits('0.29', 'USD'))).toBe(true)
    expect(toMinorUnits('0.29', 'USD')).toBe(29)
    expect(toMinorUnits('1.15', 'USD')).toBe(115)
  })
})

describe('formatMinorUnits', () => {
  it('formats with the currency symbol and separators', () => {
    expect(formatMinorUnits(123456, 'USD', 'en-US')).toBe('$1,234.56')
    expect(formatMinorUnits(500, 'JPY', 'en-US')).toBe('¥500')
    expect(formatMinorUnits(1234, 'BHD', 'en-US')).toContain('1.234')
    expect(formatMinorUnits(-4250, 'USD', 'en-US')).toBe('-$42.50')
  })
})

describe('minorToMajor', () => {
  it('scales by the currency exponent for display', () => {
    expect(minorToMajor(1234, 'USD')).toBe(12.34)
    expect(minorToMajor(500, 'JPY')).toBe(500)
    expect(minorToMajor(1234, 'BHD')).toBe(1.234)
  })
})
```

Run: `npx vitest run src/shared/lib/money.test.ts` → FAIL.

- [ ] **Step 2: Implement money.ts**

```ts
/** Number of digits after the decimal point in the currency's minor unit (USD 2, JPY 0, BHD 3). */
export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/**
 * Parses what a person typed into integer minor units without any floating-point arithmetic.
 * Returns null for anything ambiguous or too precise; it never rounds.
 */
export function toMinorUnits(input: string, currency: string): number | null {
  const digits = minorUnitDigits(currency)
  let text = input.trim().replace(/\s/g, '')

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, '')
  } else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+,\d+$/.test(text)) {
    text = text.replace(',', '.')
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return null

  const whole = match[1] ?? ''
  const fraction = match[2] ?? ''
  if (fraction.length > digits) return null

  const minor = Number(whole + fraction.padEnd(digits, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

/** For display and chart plotting only. Stored and transmitted amounts stay integers. */
export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** minorUnitDigits(currency)
}

export function formatMinorUnits(minor: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minorToMajor(minor, currency),
  )
}
```

Run the money tests → PASS.

- [ ] **Step 3: Write the failing date tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  currentMonthIso,
  daysBetween,
  formatDate,
  formatMonth,
  shiftMonthIso,
  todayIso,
} from './dates'

describe('dates', () => {
  it('todayIso uses the local calendar day', () => {
    expect(todayIso(new Date(2026, 8, 24, 23, 59))).toBe('2026-09-24')
    expect(todayIso(new Date(2026, 0, 5, 0, 0))).toBe('2026-01-05')
  })

  it('adds days across month and year ends and back', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('counts whole days between two dates, including negative and across DST', () => {
    expect(daysBetween('2026-09-24', '2026-09-27')).toBe(3)
    expect(daysBetween('2026-09-27', '2026-09-24')).toBe(-3)
    expect(daysBetween('2026-03-01', '2026-11-01')).toBe(245)
    expect(daysBetween('2026-09-24', '2026-09-24')).toBe(0)
  })

  it('formats a calendar date without shifting it by the time zone', () => {
    expect(formatDate('2026-09-24', 'en-US')).toBe('Sep 24, 2026')
    expect(formatDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026')
  })
})

describe('months', () => {
  it('reports the current local month', () => {
    expect(currentMonthIso(new Date(2026, 8, 24))).toBe('2026-09')
  })

  it.each([
    ['2026-09', 1, '2026-10'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -14, '2025-01'],
  ])('shifts %s by %i to %s', (month, delta, expected) => {
    expect(shiftMonthIso(month, delta)).toBe(expected)
  })

  it('formats a month', () => {
    expect(formatMonth('2026-09', 'en-US')).toBe('September 2026')
  })
})
```

Run → FAIL.

- [ ] **Step 4: Implement dates.ts**

```ts
const DAY_MS = 86_400_000

function toUtcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`)
}

/** The user's local calendar day as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(toUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcMs(toIso) - toUtcMs(fromIso)) / DAY_MS)
}

export function formatDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(toUtcMs(iso)))
}

export function currentMonthIso(now: Date = new Date()): string {
  return todayIso(now).slice(0, 7)
}

export function shiftMonthIso(month: string, delta: number): string {
  const [year = 0, monthNumber = 1] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function formatMonth(month: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(toUtcMs(`${month}-01`)),
  )
}
```

Run: `npx vitest run src/shared/lib` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): add integer-safe money and calendar-date helpers" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Continuous integration and milestone wrap-up

**Files:**
- Create: `.github/workflows/ci.yml` (at the repository root, `Personal_Tracker/`)

**Interfaces:**
- Produces: a CI workflow that runs lint, typecheck and tests for both apps on every pull request and on pushes to `main`.

- [ ] **Step 1: Confirm the action versions exist**

```bash
for r in actions/checkout actions/setup-node; do
  echo "$r: $(git ls-remote --tags --refs https://github.com/$r | sed 's#.*refs/tags/##' | grep -E '^v[0-9]+$' | sort -V | tail -1)"
done
```

Expected: a major version tag for each. Use the printed majors in the workflow below (the file uses `v7` for both, which was the latest on 2026-09-24; adjust if the output differs).

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

`node-version-file: .nvmrc` resolves relative to the repository root, where `.nvmrc` lives (`24`).

- [ ] **Step 3: Run the same commands locally as a dry run**

```bash
(cd backend && npm ci && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build)
```

Expected: everything passes, and `backend/dist` contains no `test` folder (`ls backend/dist` shows `app.js`, `features`, `shared`, `server.js`, `types`).

- [ ] **Step 4: Commit**

```bash
git add .github
git commit -m "chore: add CI for lint, typecheck, test and build" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Milestone verification and branch finish**

Run every check once more in both apps (`npm run lint && npm run typecheck && npm test`), then `git status` (expected: clean) and `git log --oneline` (expected: the baseline commit plus one commit for each of Tasks 2 to 12, so 12 commits). Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `chore/foundation` into `main`.
