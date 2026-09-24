# M6 Deploy and Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the code tasks (1 to 4). Tasks 5 to 7 are operations steps that need the owner's accounts (Atlas, Brevo, Render, Netlify, GitHub); an agent prepares them and the owner performs them. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0 to M5 must be merged.

**Goal:** Harden the app for production, deploy it on free tiers (Netlify frontend with an API proxy, Render backend, Atlas database, Brevo email, GitHub Actions scheduler), write the runbook, and run the two-week pilot with a small circle.

**Architecture:** No new feature slice. Small production hardening in `backend/src` (CORS origin, TLS for mail, error mapping, request logging, a usage-stats script that reads raw collections and never prints user content), two deploy config files (`render.yaml`, `netlify.toml`), a test that guards the Netlify rules, and documentation (`README.md`, `docs/runbook.md`, `docs/pilot.md`).

**Tech Stack:** Node 24, Express 5, Mongoose 9; Netlify, Render, MongoDB Atlas (free cluster), Brevo SMTP relay, GitHub Actions. No new dependencies.

**Spec:** [`../PRD.md`](../PRD.md) sections 6.4, 6.5, 8, 10, NFR-2 to NFR-5, NFR-9, NFR-10; all four success criteria S1 to S4.

## Global Constraints

- Free tiers only, verified 2026-09-24: Render free web service (spins down after 15 min idle, about 1 minute cold start, 750 instance hours per month, **outbound SMTP ports 25, 465 and 587 blocked**, no shell access); Netlify free (proxy rewrites time out after **26 s**, 300 credits per month hard limit, commercial use allowed); Atlas free cluster (0.5 GB, 500 connections, 100 ops/s, **no backups**, pauses after 30 days without connections); Brevo free (300 emails per day, SMTP relay on port **2525**, sender must be verified); GitHub Actions (scheduled runs can be delayed, and are disabled after 60 days without repository activity in a public repository).
- Secrets live only in provider dashboards and GitHub secrets. Never commit a `.env` file, a connection string, an SMTP key or the cron secret.
- The API must only be reachable from the browser through the Netlify proxy (same origin), so the refresh cookie is first-party. CORS stays locked to the one client origin as defence in depth.
- **Do not go live with a shared rate-limit bucket.** `TRUST_PROXY_HOPS` must make `req.ip` the visitor's address (Task 7 verifies it).
- No third-party analytics. Usage is measured with the stats script, which prints counts only.
- Work on branch `chore/deploy-pilot`. Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Lint, typecheck and tests must pass before each commit.

## Review Focus

1. **A cross-origin browser call.** A page on another origin must not get CORS approval, and the configured client origin must be matched even when `CLIENT_URL` was typed with a trailing slash or path. [Task 1 tests]
2. **A large request body.** An oversized JSON body must produce a clear `413`, not a `500`; a 200-row CSV import batch with 200-character notes (about 70 KB) must fit the limit. [Task 1 test; the import dialog sends batches of 200, set in M3]
3. **Mail with no TLS.** In production the mailer must refuse to send credentials over an unencrypted connection. [Task 1 test]
4. **Stats without content.** The stats output must contain counts only: no emails, names, titles or notes. [Task 2 test]
5. **Netlify rule order.** The `/api/*` proxy must come before the single-page-app fallback, otherwise every API call returns the HTML page. [Task 3 test]
6. **Rate-limit bucket.** After deploy, two visitors on different networks must appear as different addresses in the backend logs. [Task 7]
7. **Asleep on first click, and an asleep backend at 01:17 UTC.** The first visit after idle shows the waking banner and recovers; the daily workflow retries until the backend answers. [Task 7]

---

## Part A: Code

### Task 1: Production hardening

**Files:**
- Create: `backend/src/app.test.ts`, `backend/src/shared/mailer/mailer.test.ts`, `backend/src/features/auth/refresh-token.model.test.ts`
- Modify: `backend/src/app.ts`, `backend/src/shared/middleware/errorHandler.ts`, `backend/src/shared/mailer/mailer.ts`, `backend/src/features/auth/refresh-token.model.ts`

**Interfaces:**
- Produces: `app` with CORS matched to `new URL(env.CLIENT_URL).origin`, request logs that include `clientIp: req.ip`, a `413 { message }` for oversized bodies; a mailer that sets `requireTLS: true` in production; refresh tokens with a `createdAt`.

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c chore/deploy-pilot
```

- [ ] **Step 1: Write the failing app-level tests**

`backend/src/app.test.ts`:

```ts
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './app.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('security headers', () => {
  it('sets helmet defaults and does not advertise Express', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('CORS', () => {
  const preflight = (origin: string) =>
    request(app)
      .options('/api/tasks')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET')

  it('approves the configured client origin and allows credentials', async () => {
    const res = await preflight('http://localhost:5173')

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it.each(['https://evil.example', 'http://localhost:5174', 'http://localhost:5173.evil.example'])(
    'does not approve %s',
    async (origin) => {
      const res = await preflight(origin)

      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    },
  )

  it('matches the client origin even when CLIENT_URL has a trailing slash or a path', async () => {
    vi.resetModules()
    vi.stubEnv('CLIENT_URL', 'https://tracker.example.app/some/path/')
    const { app: freshApp } = await import('./app.ts')

    const res = await request(freshApp)
      .options('/api/tasks')
      .set('Origin', 'https://tracker.example.app')
      .set('Access-Control-Request-Method', 'GET')

    expect(res.headers['access-control-allow-origin']).toBe('https://tracker.example.app')
  })
})

describe('request size', () => {
  it('answers 413 in the standard error format for an oversized JSON body', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }))

    expect(res.status).toBe(413)
    expect(res.body).toEqual({ message: 'The request is too large' })
  })

  it('still answers 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Malformed JSON body' })
  })
})
```

`backend/src/shared/mailer/mailer.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: vi.fn() })))
vi.mock('nodemailer', () => ({ default: { createTransport } }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  createTransport.mockClear()
})

describe('mailer transport', () => {
  it('does not require TLS in development, where a local mail catcher has none', async () => {
    await import('./mailer.ts')

    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ requireTLS: false })
  })

  it('requires TLS in production so credentials are never sent in the clear', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SMTP_PORT', '2525')

    await import('./mailer.ts')

    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({
      host: 'localhost',
      port: 2525,
      secure: false,
      requireTLS: true,
    })
  })

  it('uses an implicit TLS connection on port 465', async () => {
    vi.stubEnv('SMTP_PORT', '465')

    await import('./mailer.ts')

    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ secure: true })
  })
})
```

`backend/src/features/auth/refresh-token.model.test.ts`:

```ts
import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { RefreshToken } from './refresh-token.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('RefreshToken', () => {
  it('records when it was issued, which is how the stats script counts active users', async () => {
    const before = Date.now()

    const token = await RefreshToken.create({
      userId: new Types.ObjectId(),
      familyId: 'family',
      tokenHash: 'hash',
      expiresAt: new Date(before + 60_000),
    })

    expect(token.get('createdAt')).toBeInstanceOf(Date)
    expect(token.get('createdAt').getTime()).toBeGreaterThanOrEqual(before)
    expect(token.get('updatedAt')).toBeUndefined()
  })
})
```

Run: `cd backend && npx vitest run src/app.test.ts src/shared/mailer/mailer.test.ts src/features/auth/refresh-token.model.test.ts` → FAIL (the mail transport has no `requireTLS`, there is no 413 mapping, the trailing-slash CORS origin does not match, and refresh tokens have no `createdAt`).

- [ ] **Step 2: Fix the CORS origin, add request logging and body-size handling**

Replace `backend/src/app.ts` (this is the file as it stands after M5, with the three changes marked):

```ts
import cors from 'cors'
import express, { type Request } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { accountRouter } from './features/account/index.ts'
import { authRouter } from './features/auth/index.ts'
import { financeRouter } from './features/finance/index.ts'
import { fixedExpenseRouter, reminderRouter } from './features/fixed-expenses/index.ts'
import { healthRouter } from './features/health/index.ts'
import { taskRouter } from './features/tasks/index.ts'
import { env } from './shared/config/env.ts'
import { logger } from './shared/logger/logger.ts'
import { errorHandler } from './shared/middleware/errorHandler.ts'
import { notFound } from './shared/middleware/notFound.ts'

export const app = express()

app.disable('x-powered-by')
app.set('trust proxy', env.TRUST_PROXY_HOPS)
app.use(helmet())
// CORS compares origins exactly, so reduce CLIENT_URL to its origin (no path, no trailing slash).
app.use(cors({ origin: new URL(env.CLIENT_URL).origin, credentials: true }))
app.use(express.json({ limit: '100kb' }))
// clientIp is req.ip, which trust-proxy resolves. The runbook uses it to verify TRUST_PROXY_HOPS.
app.use(pinoHttp({ logger, customProps: (req) => ({ clientIp: (req as Request).ip }) }))

// Feature slices
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/tasks', taskRouter)
app.use('/api', financeRouter)
app.use('/api/fixed-expenses', fixedExpenseRouter)
app.use('/api/internal/reminders', reminderRouter)
app.use('/api/account', accountRouter)

app.use(notFound)
app.use(errorHandler)
```

In `backend/src/shared/middleware/errorHandler.ts` add a helper next to `isBodyParseError`:

```ts
function isPayloadTooLarge(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large'
}
```

and extend the existing `if / else if` chain in `errorHandler` so its tail reads:

```ts
  } else if (isBodyParseError(err)) {
    status = 400
    body.message = 'Malformed JSON body'
  } else if (isPayloadTooLarge(err)) {
    status = 413
    body.message = 'The request is too large'
  }
```

- [ ] **Step 3: Require TLS for mail in production, and record refresh-token issue time**

Replace `backend/src/shared/mailer/mailer.ts`:

```ts
import nodemailer from 'nodemailer'
import { env, isProduction } from '../config/env.ts'

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  // Port 465 is an implicit-TLS connection. Other ports start plain and upgrade with STARTTLS.
  secure: env.SMTP_PORT === 465,
  // In production the connection must upgrade, or the SMTP key would travel in the clear.
  requireTLS: isProduction,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
})

export interface MailOptions {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendMail(options: MailOptions): Promise<void> {
  await transporter.sendMail({ from: env.MAIL_FROM, ...options })
}
```

In `backend/src/features/auth/refresh-token.model.ts` change the schema options so only `createdAt` is recorded (the `updatedAt` field would add a write to every rotation for no benefit):

```ts
const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
```

Run: `npx vitest run src/app.test.ts src/shared/mailer src/features/auth` → PASS.

- [ ] **Step 4: Run all checks and commit**

```bash
(cd backend && npm run lint && npm run typecheck && npm test)
git add backend
git commit -m "chore: harden CORS, mail TLS, body limits and request logging for production" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Usage statistics script

**Files:**
- Create: `backend/src/scripts/usage-stats.ts`, `usage-stats.test.ts`, `usage-stats.cli.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `collectUsageStats(db: StatsDb, now?: Date): Promise<UsageStats>` with `UsageStats = { generatedAt; users: { registered; verified; active7d; active14d }; content: { tasks; transactions; fixedExpenses }; usersWith: { tasks; transactions; bills } }`; npm scripts `stats` (from source) and `stats:built` (from `dist`). It reads raw collections and prints **counts only**.

The script does not import any model (that would break the slice boundaries); it addresses the collections by name (`users`, `refreshtokens`, `tasks`, `transactions`, `fixedexpenses`). "Active" means the user had a session issued (login or silent refresh) in the last N days, which happens on every visit.

- [ ] **Step 1: Write the failing test**

`backend/src/scripts/usage-stats.test.ts`:

```ts
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearTestDb, startTestDb, stopTestDb } from '../test/mongo.ts'
import { collectUsageStats, type StatsDb } from './usage-stats.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const NOW = new Date('2026-10-01T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
const collection = (name: string) => mongoose.connection.collection(name)

function statsDb(): StatsDb {
  const db = mongoose.connection.db
  if (!db) throw new Error('not connected')
  return db as unknown as StatsDb
}

describe('collectUsageStats', () => {
  it('counts registered and verified users', async () => {
    await collection('users').insertMany([
      { email: 'a@example.com', name: 'A', emailVerifiedAt: daysAgo(3) },
      { email: 'b@example.com', name: 'B', emailVerifiedAt: daysAgo(1) },
      { email: 'c@example.com', name: 'C' },
    ])

    const stats = await collectUsageStats(statsDb(), NOW)

    expect(stats.users).toMatchObject({ registered: 3, verified: 2 })
    expect(stats.generatedAt).toBe(NOW.toISOString())
  })

  it('counts each user once as active if a session was issued in the window', async () => {
    const [u1, u2, u3] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
    await collection('refreshtokens').insertMany([
      { userId: u1, createdAt: daysAgo(1) },
      { userId: u1, createdAt: daysAgo(2) },
      { userId: u2, createdAt: daysAgo(10) },
      { userId: u3, createdAt: daysAgo(30) },
    ])

    const { users } = await collectUsageStats(statsDb(), NOW)

    expect(users.active7d).toBe(1)
    expect(users.active14d).toBe(2)
  })

  it('counts content and how many distinct users have each kind', async () => {
    const [u1, u2] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]
    await collection('tasks').insertMany([{ userId: u1 }, { userId: u1 }, { userId: u2 }])
    await collection('transactions').insertMany([{ userId: u1 }])
    await collection('fixedexpenses').insertMany([{ userId: u2 }, { userId: u2 }])

    const stats = await collectUsageStats(statsDb(), NOW)

    expect(stats.content).toEqual({ tasks: 3, transactions: 1, fixedExpenses: 2 })
    expect(stats.usersWith).toEqual({ tasks: 2, transactions: 1, bills: 1 })
  })

  it('returns zeros for an empty database', async () => {
    const stats = await collectUsageStats(statsDb(), NOW)

    expect(stats.users).toEqual({ registered: 0, verified: 0, active7d: 0, active14d: 0 })
    expect(stats.content).toEqual({ tasks: 0, transactions: 0, fixedExpenses: 0 })
  })

  it('never includes emails, names, titles, notes or ids', async () => {
    const userId = new mongoose.Types.ObjectId()
    await collection('users').insertOne({ email: 'private@example.com', name: 'Private Person', emailVerifiedAt: daysAgo(1) })
    await collection('tasks').insertOne({ userId, title: 'secret task title' })
    await collection('transactions').insertOne({ userId, note: 'secret note' })
    await collection('refreshtokens').insertOne({ userId, createdAt: daysAgo(1) })

    const text = JSON.stringify(await collectUsageStats(statsDb(), NOW))

    for (const secret of ['private@example.com', 'Private Person', 'secret task title', 'secret note', userId.toString(), '@']) {
      expect(text).not.toContain(secret)
    }
  })
})
```

Run: `npx vitest run src/scripts` → FAIL (module missing).

- [ ] **Step 2: Implement**

`backend/src/scripts/usage-stats.ts`:

```ts
/** The little of the MongoDB driver's collection API the script needs. */
export interface StatsCollection {
  countDocuments(filter?: object): Promise<number>
  distinct(key: string, filter?: object): Promise<unknown[]>
}

export interface StatsDb {
  collection(name: string): StatsCollection
}

export interface UsageStats {
  generatedAt: string
  users: { registered: number; verified: number; active7d: number; active14d: number }
  content: { tasks: number; transactions: number; fixedExpenses: number }
  usersWith: { tasks: number; transactions: number; bills: number }
}

const DAY_MS = 86_400_000

/**
 * Counts only: no email, name, title, note or id ever leaves this function. It addresses the
 * collections by name so it does not depend on any slice's internals.
 */
export async function collectUsageStats(db: StatsDb, now: Date = new Date()): Promise<UsageStats> {
  const since = (days: number) => ({ createdAt: { $gte: new Date(now.getTime() - days * DAY_MS) } })
  const distinctUsers = async (name: string, filter?: object) =>
    (await db.collection(name).distinct('userId', filter)).length

  const [registered, verified, active7d, active14d, tasks, transactions, fixedExpenses, withTasks, withTransactions, withBills] =
    await Promise.all([
      db.collection('users').countDocuments(),
      db.collection('users').countDocuments({ emailVerifiedAt: { $exists: true } }),
      distinctUsers('refreshtokens', since(7)),
      distinctUsers('refreshtokens', since(14)),
      db.collection('tasks').countDocuments(),
      db.collection('transactions').countDocuments(),
      db.collection('fixedexpenses').countDocuments(),
      distinctUsers('tasks'),
      distinctUsers('transactions'),
      distinctUsers('fixedexpenses'),
    ])

  return {
    generatedAt: now.toISOString(),
    users: { registered, verified, active7d, active14d },
    content: { tasks, transactions, fixedExpenses },
    usersWith: { tasks: withTasks, transactions: withTransactions, bills: withBills },
  }
}
```

`backend/src/scripts/usage-stats.cli.ts`:

```ts
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../shared/db/connect.ts'
import { collectUsageStats, type StatsDb } from './usage-stats.ts'

await connectDatabase()
try {
  const db = mongoose.connection.db
  if (!db) throw new Error('Database connection is not ready')
  const stats = await collectUsageStats(db as unknown as StatsDb)
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`)
} finally {
  await disconnectDatabase()
}
```

In `backend/package.json` add to `scripts`:

```json
    "stats": "node --env-file-if-exists=.env src/scripts/usage-stats.cli.ts",
    "stats:built": "node --env-file-if-exists=.env dist/scripts/usage-stats.cli.js",
```

Run: `npx vitest run src/scripts` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add backend
git commit -m "feat(ops): add a counts-only usage statistics script for the pilot" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Deploy configuration files and a guard test

**Files:**
- Create: `render.yaml`, `netlify.toml` (both at the repository root), `frontend/src/app/deployConfig.test.ts`

**Interfaces:**
- Produces: a Render blueprint for the backend service, a Netlify config that proxies `/api/*` to it, falls back to `index.html` for client-side routes, and sets security headers including a Content-Security-Policy.

- [ ] **Step 1: Write the failing guard test**

`frontend/src/app/deployConfig.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8')

describe('netlify.toml', () => {
  const toml = read('netlify.toml')

  it('proxies /api/* to the backend before the single-page-app fallback', () => {
    const apiRule = toml.indexOf('from = "/api/*"')
    const fallbackRule = toml.indexOf('from = "/*"')

    expect(apiRule).toBeGreaterThan(-1)
    expect(fallbackRule).toBeGreaterThan(apiRule)
  })

  it('proxies as a rewrite (status 200), not a redirect, so the cookie stays first-party', () => {
    const apiBlock = toml.slice(toml.indexOf('from = "/api/*"'), toml.indexOf('from = "/*"'))

    expect(apiBlock).toMatch(/status = 200/)
    expect(apiBlock).toMatch(/to = "https:\/\/[^"]+\/api\/:splat"/)
  })

  it('points the proxy at the service defined in render.yaml', () => {
    const service = /name: (\S+)/.exec(read('render.yaml'))?.[1]
    const target = /to = "https:\/\/([^."]+)\.onrender\.com\/api\/:splat"/.exec(toml)?.[1]

    expect(service).toBeDefined()
    expect(target).toBe(service)
  })

  it('builds the frontend from its folder and publishes dist', () => {
    expect(toml).toMatch(/base = "frontend"/)
    expect(toml).toMatch(/command = "npm run build"/)
    expect(toml).toMatch(/publish = "dist"/)
  })

  it.each([
    'Referrer-Policy = "no-referrer"',
    'X-Content-Type-Options = "nosniff"',
    'X-Frame-Options = "DENY"',
    "default-src 'self'",
    "script-src 'self'",
    "frame-ancestors 'none'",
  ])('sets the security header %s', (header) => {
    expect(toml).toContain(header)
  })

  it('does not allow inline or remote scripts', () => {
    const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)?.[1] ?? ''

    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).not.toMatch(/script-src[^;]*https?:/)
  })
})

describe('render.yaml', () => {
  const yaml = read('render.yaml')

  it('is a free Node web service rooted in backend with a health check', () => {
    expect(yaml).toMatch(/plan: free/)
    expect(yaml).toMatch(/runtime: node/)
    expect(yaml).toMatch(/rootDir: backend/)
    expect(yaml).toMatch(/healthCheckPath: \/api\/health/)
  })

  it.each(['NODE_VERSION', 'NODE_ENV', 'TRUST_PROXY_HOPS', 'MONGODB_URI', 'JWT_SECRET', 'CRON_SECRET', 'CLIENT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'])(
    'declares %s',
    (key) => {
      expect(yaml).toContain(`key: ${key}`)
    },
  )

  it('sends mail through port 2525, which Render does not block', () => {
    expect(yaml).toMatch(/key: SMTP_PORT\s+value: "?2525"?/)
  })

  it('never contains a secret value', () => {
    expect(yaml).not.toMatch(/mongodb\+srv:\/\//)
    expect(yaml).not.toMatch(/xsmtpsib-/)
  })
})
```

Run: `cd frontend && npx vitest run src/app/deployConfig.test.ts` → FAIL (the files do not exist).

- [ ] **Step 2: Write `render.yaml`**

`render.yaml` (repository root):

```yaml
# Render Blueprint for the API. Create it with: Render dashboard > New > Blueprint.
services:
  - type: web
    name: personal-tracker-api
    runtime: node
    plan: free
    # Pick the region closest to your users and to the Atlas cluster.
    region: singapore
    rootDir: backend
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /api/health
    autoDeploy: true
    envVars:
      - key: NODE_VERSION
        value: 24
      - key: NODE_ENV
        value: production
      # Netlify's proxy and Render's load balancer are both in front of the app. Verified after
      # deploy (docs/runbook.md, "Verify the visitor's address").
      - key: TRUST_PROXY_HOPS
        value: 2
      - key: MONGODB_URI
        sync: false
      - key: JWT_SECRET
        generateValue: true
      - key: CRON_SECRET
        sync: false
      - key: CLIENT_URL
        sync: false
      # Brevo's SMTP relay on 2525: Render's free tier blocks ports 25, 465 and 587.
      - key: SMTP_HOST
        value: smtp-relay.brevo.com
      - key: SMTP_PORT
        value: 2525
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false
      - key: MAIL_FROM
        sync: false
```

- [ ] **Step 3: Write `netlify.toml`**

`netlify.toml` (repository root):

```toml
[build]
  base = "frontend"
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "24"

# The browser only ever talks to this site. The API is reached through a rewrite (status 200),
# so the refresh cookie is first-party. Keep this rule ABOVE the fallback below.
[[redirects]]
  from = "/api/*"
  to = "https://personal-tracker-api.onrender.com/api/:splat"
  status = 200
  force = true

# Client-side routes (react-router) all serve the app shell.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    Referrer-Policy = "no-referrer"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
```

The proxy target uses the service name from `render.yaml`. If Render gives the service a different hostname (the name was taken), Task 7 updates the `to` line, and the guard test then requires `render.yaml`'s `name` to match, so change both.

Run: `npx vitest run src/app/deployConfig.test.ts` → PASS.

- [ ] **Step 4: Prove the frontend build works with these rules**

```bash
npm run build && ls dist && grep -c "<script" dist/index.html
```

Expected: the build succeeds and `dist/index.html` has only external scripts (no inline `<script>` bodies, which the CSP would block). Check with `grep -E "<script[^>]*>[^<]+</script>" dist/index.html || echo "no inline scripts"`.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add render.yaml netlify.toml frontend
git commit -m "chore(deploy): add Render blueprint and Netlify config with a guard test" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: README, runbook and pilot guide

**Files:**
- Create: `README.md` (repository root), `docs/runbook.md`, `docs/pilot.md`

These documents are the deliverable of this task. Write them exactly as below.

- [ ] **Step 1: Write `README.md`**

````markdown
# Personal Life Tracker

A multi-tenant web app for personal tasks (Kanban), finances (transactions and charts) and fixed expenses (email reminders). MERN stack, organised by feature slices. See `CLAUDE.md` for the architecture and security rules.

## Documentation

| Document | What it is |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements for the POC |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Layout, colours and the decision log |
| [`docs/plans/00-overview.md`](docs/plans/00-overview.md) | How the work is planned and the shared contracts |
| [`docs/stories/`](docs/stories/) | User stories, one file per story, with tasks and status |
| [`docs/runbook.md`](docs/runbook.md) | Deploying, operating and backing up the app |
| [`docs/pilot.md`](docs/pilot.md) | Running the two-week pilot |

## Run it locally

Requires Node 24 (`nvm use`), a MongoDB, and an SMTP catcher such as [Mailpit](https://mailpit.axllent.org) on port 1025.

```bash
docker run -d --name tracker-mongo -p 27017:27017 mongo:8      # or any MongoDB
cd backend && cp .env.example .env && npm install && npm run dev  # http://localhost:5000
cd frontend && npm install && npm run dev                         # http://localhost:5173
```

Set `JWT_SECRET` and `CRON_SECRET` in `backend/.env` to long random values
(`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) and `TRUST_PROXY_HOPS=0`.

## Checks

```bash
cd backend && npm run lint && npm run typecheck && npm test
cd frontend && npm run lint && npm run typecheck && npm test
```

The first backend test run downloads a `mongod` binary (about 100 MB).

## Structure

`backend/src/features/<slice>` and `frontend/src/features/<slice>` hold everything a feature needs. Slices talk to each other only through their `index.ts`. Shared code lives in `shared/` and never imports a feature.
````

- [ ] **Step 2: Write `docs/runbook.md`**

````markdown
# Runbook

How to deploy, operate and back up the app on free tiers. Free-tier limits were verified on 2026-09-24; re-check them before deploying (see "Free-tier limits").

## Architecture in one picture

```
Browser ──► Netlify (static app + /api/* rewrite) ──► Render (Express) ──► MongoDB Atlas
                                                         │
GitHub Actions (daily cron) ─────────────────────────────┘  POST /api/internal/reminders/run
Render ──► Brevo SMTP relay (port 2525) ──► users' inboxes
```

## Accounts you need

| Service | Used for | Cost |
|---|---|---|
| GitHub | Code, CI, the daily reminder workflow | Free |
| MongoDB Atlas | Database (free cluster) | Free |
| Brevo | Email (SMTP relay, 300 emails a day) | Free |
| Render | Backend (free web service) | Free |
| Netlify | Frontend and API proxy | Free |

## Environment variables

Set on Render (values marked "generate" you create yourself):

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24` (in `render.yaml`) |
| `NODE_ENV` | `production` (in `render.yaml`) |
| `MONGODB_URI` | Atlas connection string, with the database name `life-tracker` |
| `JWT_SECRET` | Generated by Render (`generateValue`) |
| `CRON_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Also store it as a GitHub secret with the same value |
| `CLIENT_URL` | The Netlify site URL, for example `https://your-site.netlify.app` (used in email links and for CORS) |
| `TRUST_PROXY_HOPS` | `2`, verified below |
| `SMTP_HOST` / `SMTP_PORT` | `smtp-relay.brevo.com` / `2525` |
| `SMTP_USER` / `SMTP_PASS` | Your Brevo login and an SMTP key |
| `MAIL_FROM` | `Life Tracker <address you verified in Brevo>` |

GitHub repository secrets: `BACKEND_URL` (the Render URL, no trailing slash) and `CRON_SECRET`.

## First deployment

Order matters: database, email, backend, frontend, scheduler.

1. **Database.** In Atlas create a free cluster (choose a region near the Render region), a database user with a long random password, and under Network Access allow `0.0.0.0/0` (Render's free tier has no fixed outbound IPs; the long password and TLS are the protection). Copy the connection string and add `/life-tracker` as the database name.
2. **Email.** In Brevo create an account, verify the sender address you will use for `MAIL_FROM` (Senders, Domains and Dedicated IPs), and create an SMTP key. A free-mail sender address (for example Gmail) can land in spam; if it does during the pilot, the only fix is a domain you own.
3. **Repository.** Push `main` to GitHub. Add the two Actions secrets later, in step 6.
4. **Backend.** In Render: New, Blueprint, choose the repository. Render reads `render.yaml`. Fill the variables marked `sync: false`. After the first deploy, note the service URL (`https://<name>.onrender.com`). If it is not `https://personal-tracker-api.onrender.com`, change the `to` line in `netlify.toml` **and** `name:` in `render.yaml`, and push.
5. **Frontend.** In Netlify: Add new site, Import from Git, pick the repository. `netlify.toml` supplies the build settings. After it deploys, copy the site URL, set `CLIENT_URL` on Render to it, and let Render redeploy.
6. **Scheduler.** In GitHub: Settings, Secrets and variables, Actions: add `BACKEND_URL` and `CRON_SECRET`. Then run the workflow "Send fixed-expense reminders" once by hand (Actions tab, Run workflow) and confirm it succeeds.
7. **Verify** with the smoke tests and the visitor-address check below.

## Verify the visitor's address (blocking)

Rate limiting keys on `req.ip`. Behind two proxies, a wrong `TRUST_PROXY_HOPS` makes every visitor look like Netlify's server, which would give the whole site one shared login bucket.

1. From your phone on **mobile data** (a different network from your computer), open `https://<site>/api/health`. Note the public IP of that phone (search "what is my IP").
2. In Render, open the service logs and find the request. Each line includes `clientIp` and the request headers including `x-forwarded-for`.
3. Decide:
   - `clientIp` equals your phone's public IP: correct. Keep `TRUST_PROXY_HOPS`.
   - `clientIp` is a Netlify or Render address, and `x-forwarded-for` shows `<your IP>, <other>`: increase `TRUST_PROXY_HOPS` by one and repeat.
   - `x-forwarded-for` never contains your IP: **stop.** Do not go live. The visitor's address arrives in another header and the rate-limit key must be changed in code first.
4. Repeat from your computer's network and confirm a different `clientIp`.

## Smoke tests

Run these on the deployed site (not localhost), in a private window.

| Do this | Expect |
|---|---|
| Open the site after 20 minutes of inactivity | A "waking up the server" banner, then the login page within about a minute. No error page |
| Register, open the verification email, click the link | Email arrives within a minute, from your verified sender, the link lands on the site and verifies |
| Log in, reload, open a second tab | Still signed in on reload and in the second tab |
| Add a task, drag it, add a transaction, a bill due in 2 days | All work; charts draw |
| Run the reminder workflow by hand | The reminder email arrives once; running it again sends nothing |
| Download JSON export | No password or token inside |
| Try a wrong password 25 times from one network | Rate limited (429) after 20 within 15 minutes; a different network is not affected |
| Browser DevTools: Application, Cookies | `refresh_token` is HttpOnly and Secure; `localStorage` holds only `theme` |
| Try `https://<render-url>/api/tasks` directly | 401, and a browser page on another origin cannot read it (CORS) |

## Keeping it awake (optional)

The free backend sleeps after 15 minutes idle. One always-on service fits inside Render's 750 free hours a month. To remove most cold starts, call `GET https://<render-url>/api/health` every 10 minutes from a free external scheduler (for example cron-job.org, whose free plan allows it; check its terms). Do not use GitHub Actions for this: at that frequency it exceeds the minutes of a private repository.

## Weekly checks during the pilot

| Check | Where | Limit |
|---|---|---|
| Emails sent today | Brevo dashboard | 300 per day |
| Netlify credits used | Netlify usage | 300 per month, hard stop |
| Render instance hours | Render dashboard | 750 per month |
| Atlas storage and operations | Atlas metrics | 0.5 GB, 100 ops per second, 10 GB in and out per rolling 7 days |
| The daily workflow ran and succeeded | GitHub, Actions | Scheduled runs pause after 60 days without repository activity in a public repo |
| Usage numbers | `npm run stats` (below) | Success criteria S3 |

## Usage statistics

Runs from your computer against the production database. It prints counts only.

```bash
cd backend
MONGODB_URI="<atlas connection string>" JWT_SECRET=x CRON_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  CLIENT_URL=http://localhost:5173 SMTP_HOST=x SMTP_PORT=25 MAIL_FROM=x npm run stats
```

`active7d` and `active14d` count users who had a session issued in that window (every visit does).

## Backup and restore

Atlas free clusters cannot enable backups. Take one before any risky change and weekly during the pilot:

```bash
brew install mongodb-database-tools            # once
mongodump --uri "<atlas connection string>" --gzip --archive="tracker-$(date +%F).gz"
# restore into a scratch database to test it:
mongorestore --uri "mongodb://127.0.0.1:27017" --gzip --archive="tracker-2026-10-01.gz" --nsFrom "life-tracker.*" --nsTo "restore-test.*"
```

Keep backups private (they contain users' data). Users can also export their own data from Settings.

## Rotating secrets

| Secret | How |
|---|---|
| `JWT_SECRET` | Change it on Render. Everyone's access token stops working (they refresh silently) |
| `CRON_SECRET` | Change it on Render **and** in the GitHub secret together, then run the workflow once |
| Brevo SMTP key | Create a new key, change `SMTP_PASS` on Render, delete the old key |
| Atlas password | Change the user's password, update `MONGODB_URI` on Render |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| First visit shows "waking up" for a long time | Cold start (about a minute). If it never ends, check the Render logs and health check |
| Login works but the user is logged out on reload | The cookie is not first-party: the browser is calling Render directly instead of `/api` on Netlify, or `netlify.toml` rule order is wrong |
| Every API call returns the app's HTML | The `/api/*` rewrite is missing or below the fallback rule |
| No emails arrive | `SMTP_PORT` is not 2525, the Brevo sender is not verified, or the daily quota is used. Check the Render logs for "Failed to send email" |
| Reminders did not go out | Check the Actions run and its response. The endpoint answers counts; `failed` means mail trouble |
| 429 for legitimate users | `TRUST_PROXY_HOPS` is wrong (all visitors share one address). Re-run the visitor-address check |
| Atlas connection errors after a quiet month | The cluster paused after 30 days without connections. Resume it in Atlas |
| GitHub says the schedule is disabled | 60 days without repository activity. Push a commit or re-enable the workflow |

## Free-tier limits (verified 2026-09-24)

| Service | Limits that matter |
|---|---|
| Render free web service | Spins down after 15 minutes without traffic, about 1 minute to wake. 750 instance hours a month. Outbound SMTP ports 25, 465 and 587 blocked. No shell |
| Netlify free | Proxy rewrites time out after 26 seconds. 300 credits a month, hard limit. Commercial use allowed |
| MongoDB Atlas free | 0.5 GB, 500 connections, 100 operations a second, 10 GB in and 10 GB out per rolling 7 days. No backups. Pauses after 30 days without connections |
| Brevo free | 300 emails a day. SMTP relay with a verified sender |
| GitHub Actions | Scheduled runs can be delayed at the start of the hour. Disabled after 60 days without repository activity in a public repository |
````

- [ ] **Step 3: Write `docs/pilot.md`**

````markdown
# Pilot Guide

A two-week pilot with a small circle of real users, to test whether people who are not the builders can sign up, verify their email and get value without help.

## Goals and how they are measured

| PRD criterion | Target | Evidence |
|---|---|---|
| S1 Security | Zero known cross-tenant leaks | Tenant-isolation tests green in CI; nothing reported |
| S2 Reminders | Emails arrive on the right day, never twice | Actions run history; ask pilot users; spot-check inboxes |
| S3 Real usage | 5 to 10 people active for 2 or more weeks (adjust in PRD Q1) | `npm run stats` weekly: `verified`, `active7d`, `active14d`, `usersWith` |
| S4 Free budget | A month at $0 inside every limit | The weekly checks in the runbook |

## Before inviting anyone

- [ ] All smoke tests in the runbook pass on the deployed site, including the visitor-address check.
- [ ] The daily workflow has run successfully at least once on its own schedule.
- [ ] You have taken and test-restored one backup.
- [ ] You have read the export of a test account and confirmed it contains no password or token.
- [ ] You know how to resume a paused Atlas cluster and re-enable the GitHub schedule.

## Inviting people

Send each person a message like this. Be honest that it is a pilot.

> I built a small app for tracking tasks, money and regular bills, with email reminders before bills are due. I would love you to use it for two weeks and tell me what is annoying or missing. It runs on free hosting, so the first page load after a quiet spell can take up to a minute, and please do not treat it as your only copy of anything important (you can download your data from Settings any time). Sign up here: <site URL>. Your data is private to you; I only look at usage counts, never your content. If anything breaks or confuses you, reply to this message.

Ask each person to: sign up and verify, add a real bill with a reminder, add a few real tasks and a week of transactions, and open the app on their phone.

## During the two weeks

| When | What you do |
|---|---|
| Day 0 | Invite, watch the first sign-ups in the logs, be available to help |
| Every Monday | Run `npm run stats`, do the weekly checks, take a backup, note the numbers below |
| Any time | Fix only real bugs and blockers on `fix/` branches. Put wishes in the backlog, do not build them |
| Day 7 | Short check-in message: "Anything confusing or broken so far?" |
| Day 14 | The feedback check-in (below) |

Record the numbers:

| Date | registered | verified | active7d | active14d | tasks | transactions | bills | Emails sent (Brevo) | Problems |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## Feedback check-in (day 14)

Ask each person, in a message or a short call:

1. What did you use it for in the last two weeks?
2. Did the reminder emails arrive when you expected? Did you act on any?
3. What was the most annoying thing?
4. What did you wish it could do?
5. Was anything confusing during sign-up or the first minutes?
6. How did it feel on your phone?
7. Would you keep using it? Why or why not?
8. Did you ever worry about your data being safe?

## Handling problems

| Situation | Response |
|---|---|
| A user reports seeing someone else's data | **Stop the pilot.** Take the site down (pause the Render service), take a backup, find the leak, fix it with a test, tell every user |
| Emails stop arriving | Check the Brevo quota and the Render logs; if the quota is the cause, pause new sign-ups until the next day |
| A user forgets their password | They use "Forgot your password?". Never reset it for them by hand |
| A user wants their data deleted | They use Settings, Delete account. Confirm the account is gone with `npm run stats` |
| Data loss on the free database | Restore from the latest backup (runbook) and tell users what was lost |

## Ending the pilot

- [ ] Write down which success criteria were met and by how much.
- [ ] Sort the feedback into: bugs, things people asked for, things that confused people.
- [ ] Decide: **continue** as is, **upgrade** a paid tier or a domain (only if the free limits or email deliverability were the problem), or **stop**.
- [ ] If stopping: tell users, offer the export, then delete accounts through the app or drop the database, pause the Render service and delete the Netlify site.
- [ ] Add the results to `docs/pilot-results.md` and update the PRD open questions (Q1 to Q7) with what you learned.

## Out of scope until after the pilot

Custom columns and multiple boards, multi-currency, push notifications, marking bills paid, sharing, native apps and bank connections (PRD section 3.2).
````

- [ ] **Step 4: Check the links and commit**

```bash
grep -rn "docs/stories\|docs/plans" README.md | head
git add README.md docs/runbook.md docs/pilot.md
git commit -m "docs: add the README, the operations runbook and the pilot guide" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

`docs/stories/` is created by the user-stories deliverable, so the README link is valid once that folder exists.

---

## Part B: Operations (owner-run, agent-assisted)

These steps need the owner's accounts and cannot be done by an agent alone. The agent prepares each step, gives the exact values to use, and checks the results. Follow `docs/runbook.md`.

### Task 5: First deployment

**Files:** none (provider dashboards). `netlify.toml` and `render.yaml` change only if the Render hostname differs.

- [ ] **Step 1: Merge the code first.** Finish Tasks 1 to 4, run every check in both apps, and merge `chore/deploy-pilot` into `main` (superpowers:finishing-a-development-branch). Push `main` to a new GitHub repository (private is fine for the pilot; a private repository has a monthly Actions minute allowance, which one daily run does not approach).

- [ ] **Step 2: Do runbook "First deployment" steps 1 to 6 in order.** Record each provider URL and the date in a private note (not in the repository).

- [ ] **Step 3: Check the first deploy.** Open `https://<render-url>/api/health`: expect `{"status":"ok","database":"up"}`. If the database is `down`, check the Atlas network access rule and the connection string.

- [ ] **Step 4: If the Render hostname differs from `personal-tracker-api`, fix both files and push:**

```bash
# in render.yaml: name: <the real service name>
# in netlify.toml: to = "https://<the real host>.onrender.com/api/:splat"
cd frontend && npx vitest run src/app/deployConfig.test.ts   # the guard test must still pass
git switch -c fix/deploy-proxy-target
git add render.yaml netlify.toml
git commit -m "fix(deploy): point the Netlify proxy at the real Render hostname" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

Merge it, and confirm Netlify redeploys.

- [ ] **Step 5: Confirm CORS and cookies work through the proxy.** In a private window open the Netlify site, register, verify, log in, reload. Expect to stay signed in.

### Task 6: Verify the visitor's address and the whole system

- [ ] **Step 1: Run the runbook section "Verify the visitor's address (blocking)".** Do not continue until it passes. Record the final `TRUST_PROXY_HOPS`. If you changed it on Render, wait for the redeploy and repeat once.

- [ ] **Step 2: Run every smoke test** in the runbook. For any failure, fix it on a `fix/` branch with a test where the cause is code, or in the provider settings where it is configuration, and repeat the failed test.

- [ ] **Step 3: Prove the scheduler.** Create a bill due in 2 days with a 3-day reminder, run the workflow by hand from the Actions tab, and check the inbox. Run it again and confirm no second email. Then leave it for one real scheduled run (01:17 UTC) and confirm it ran without help.

- [ ] **Step 4: Prove the cold start on the real host.** Wait 20 minutes without visiting (or pause and resume the Render service), open the site, and confirm the waking banner appears and the app recovers by itself, and that the login page does not show an error.

- [ ] **Step 5: Take and test a backup** (runbook "Backup and restore").

- [ ] **Step 6: Optional keep-alive.** Set up the external ping from the runbook if the cold start is annoying in daily use.

### Task 7: The pilot

- [ ] **Step 1: Complete "Before inviting anyone"** in `docs/pilot.md`.

- [ ] **Step 2: Invite the circle**, using the message in the pilot guide, and fill in the first row of the numbers table.

- [ ] **Step 3: Run the two weeks** as described: Monday stats, weekly checks and backup, fix only blockers.

- [ ] **Step 4: Hold the day-14 check-in** and write the results into `docs/pilot-results.md`, covering S1 to S4, the sorted feedback, and the continue, upgrade or stop decision.

- [ ] **Step 5: Close out.** Update the PRD's open questions with the answers, move the sorted feedback into the backlog, and either continue, upgrade or stop as decided.
