# M1 Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`00-overview.md`](./00-overview.md) first. M0 must be merged.

**Goal:** Real registration with email verification, login with a short-lived access token and a rotating refresh cookie, logout, password reset, password change and profile edit, on both backend and frontend.

**Architecture:** Backend slice `features/auth` (models, per-concern services and controllers, one router) exposing a small public API in `index.ts`. Frontend slice `features/auth` (Zustand session store holding the access token in memory only, API functions, TanStack Query mutation hooks, pages, route guards). The shared Axios client learns to refresh the session once on a 401 and retry.

**Tech Stack:** Express 5, Mongoose 9, Zod 4, bcryptjs, jsonwebtoken, Nodemailer (existing); React 19, React Hook Form + Zod, TanStack Query, Zustand.

**Spec:** [`../PRD.md`](../PRD.md) AUTH-1 to AUTH-13, section 6.4, NFR-1 to NFR-3.

## Global Constraints

- bcryptjs in a Mongoose `pre('save')` hook, cost 12 (4 only when `NODE_ENV=test`); the password field has `select: false`.
- Verification and reset tokens: `crypto.randomBytes(32)` (64 hex chars), only the SHA-256 hash stored, single use. Reset expiry 15 minutes, verification expiry 24 hours.
- Access token about 15 minutes (`env.JWT_EXPIRES_IN`), refresh token 30 days sliding (`env.REFRESH_TOKEN_TTL_DAYS`), stored hashed, rotated on every use.
- Refresh cookie: `httpOnly`, `secure` in production, `sameSite=lax`, `path=/api/auth`.
- Never reveal whether an email exists. Never return password hashes or tokens (except the access token the client must hold). Never log secrets or tokens.
- **The access token is never written to `localStorage`, `sessionStorage` or a cookie the page can read.**
- Backend relative imports include `.ts`; frontend uses `@/`; slices talk through `index.ts` only; `shared/` never imports `features/`.
- Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"`. Work on branch `feature/auth-accounts`. Run lint, typecheck and tests before every commit.

## Review Focus

1. **Two users, one browser.** Logging in must clear the TanStack Query cache, and so must logout and a failed refresh, so the second user never sees the first user's data. [Tasks 9, 10, 12 tests]
2. **Token in the URL.** The verification and reset pages must remove `?token=` from the address bar, and React StrictMode's double effect must not use the token twice. [Task 11 tests]
3. **Two tabs restoring at once.** A rotated refresh token reused within 10 s must return 401 without revoking the family; reuse after 10 s must revoke it. [Task 5 tests]
4. **Same answer for known and unknown emails** on register, resend-verification and forgot-password (status and body). [Tasks 3, 6 tests]
5. **Token misuse.** A verification token must not work as a reset token, expired and already-used tokens must fail, and a rejected weak password must not burn a valid reset token. [Tasks 3, 6 tests]
6. **Wrong current password on change-password must be 403, not 401**, because the client treats 401 as "session expired". [Task 6 test]
7. **Known limitation (documented, not fixed):** `resend-verification` and `forgot-password` do slightly more work for existing accounts (sending mail), which a patient attacker could time. The 5-per-hour-per-IP mail rate limit makes bulk enumeration impractical. `register` is timing-equalised.

---

## Part A: Backend

### Task 1: Token, cookie and password-policy utilities

**Files:**
- Create: `backend/src/features/auth/tokens.ts`, `tokens.test.ts`, `cookies.ts`, `cookies.test.ts`, `password-policy.ts`, `password-policy.test.ts`

**Interfaces:**
- Produces: `generateToken(): { raw: string; hash: string }`, `hashToken(raw: string): string`; `REFRESH_COOKIE`, `parseCookies(header: string | undefined): Record<string, string>`, `readRefreshCookie(req: Request): string | undefined`, `setRefreshCookie(res: Response, token: string, expires: Date): void`, `clearRefreshCookie(res: Response): void`; `isCommonPassword(password: string): boolean`.

- [ ] **Step 0: Create the branch**

```bash
git switch main && git switch -c feature/auth-accounts
```

- [ ] **Step 1: Write the failing tests**

`backend/src/features/auth/tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from './tokens.ts'

describe('tokens', () => {
  it('generates a 64-character hex token and its SHA-256 hash', () => {
    const { raw, hash } = generateToken()

    expect(raw).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(hashToken(raw))
    expect(hash).not.toBe(raw)
  })

  it('generates a different token every time', () => {
    expect(generateToken().raw).not.toBe(generateToken().raw)
  })

  it('hashes with SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
```

`backend/src/features/auth/cookies.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCookies } from './cookies.ts'

describe('parseCookies', () => {
  it('parses several cookies', () => {
    expect(parseCookies('a=1; b=two; c=3')).toEqual({ a: '1', b: 'two', c: '3' })
  })

  it('keeps an equals sign inside a value', () => {
    expect(parseCookies('token=abc=def')).toEqual({ token: 'abc=def' })
  })

  it('decodes percent-encoding and survives malformed encoding', () => {
    expect(parseCookies('a=hello%20world; b=%E0%A4%A')).toEqual({
      a: 'hello world',
      b: '%E0%A4%A',
    })
  })

  it('ignores empty input, empty names and parts without a value', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies('=x; junk; ok=1')).toEqual({ ok: '1' })
  })
})
```

`backend/src/features/auth/password-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isCommonPassword } from './password-policy.ts'

describe('isCommonPassword', () => {
  it.each(['password1234', 'Password123', 'QWERTYUIOP', '1234567890', 'aaaaaaaaaaaa'])(
    'flags %s',
    (password) => {
      expect(isCommonPassword(password)).toBe(true)
    },
  )

  it.each(['correct-horse-battery', 'T7#kd92!Lp0x', 'my dog is called Rex 42'])(
    'accepts %s',
    (password) => {
      expect(isCommonPassword(password)).toBe(false)
    },
  )
})
```

Run: `cd backend && npx vitest run src/features/auth` → FAIL (three modules missing).

- [ ] **Step 2: Implement the utilities**

`backend/src/features/auth/tokens.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** A random URL-safe token to email or set as a cookie, and the hash that is stored. */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  return { raw, hash: hashToken(raw) }
}
```

`backend/src/features/auth/cookies.ts`:

```ts
import type { CookieOptions, Request, Response } from 'express'
import { isProduction } from '../../shared/config/env.ts'

export const REFRESH_COOKIE = 'refresh_token'

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/api/auth',
}

/** Minimal Cookie header parser. cookie-parser is not in the approved stack. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (!name) continue
    const value = part.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

export function readRefreshCookie(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[REFRESH_COOKIE]
}

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, expires })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions)
}
```

`backend/src/features/auth/password-policy.ts`:

```ts
// Only entries of 10 or more characters matter: shorter passwords fail the length rule anyway.
const COMMON_PASSWORDS = new Set([
  'password12',
  'password123',
  'password1234',
  'password12345',
  'passw0rd123',
  'passwordpassword',
  '1234567890',
  '0123456789',
  '12345678910',
  '1q2w3e4r5t',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'qwerty123456',
  'iloveyou12',
  'iloveyou123',
  'letmein1234',
  'welcome123',
  'welcome1234',
  'admin12345',
  'administrator',
  'changeme123',
  'abc1234567',
  'trustno1234',
  'football123',
  'baseball123',
  'superman123',
  'monkey12345',
  'dragon12345',
  'master12345',
])

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)
}
```

Run: `npx vitest run src/features/auth` → PASS.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): add token, cookie and password-policy utilities" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Auth models

**Files:**
- Create: `backend/src/features/auth/constants.ts`, `user.model.ts`, `user.model.test.ts`, `email-token.model.ts`, `refresh-token.model.ts`

**Interfaces:**
- Consumes: `env`.
- Produces: `BCRYPT_COST`, `VERIFY_TOKEN_TTL_MS`, `RESET_TOKEN_TTL_MS`, `REFRESH_REUSE_GRACE_MS`; `User` model with `UserAttrs { email; password; name; currency; emailVerifiedAt?: Date }` and `type UserDoc`; `EmailToken` (`userId`, `purpose: 'verify' | 'reset'`, `tokenHash`, `expiresAt`, `usedAt?`) and `type EmailTokenPurpose`; `RefreshToken` (`userId`, `familyId`, `tokenHash`, `expiresAt`, `revokedAt?`).

- [ ] **Step 1: Write the failing model test**

`backend/src/features/auth/user.model.test.ts`:

```ts
import bcrypt from 'bcryptjs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { User } from './user.model.ts'

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

const attrs = {
  email: ' Ada@Example.com ',
  password: 'correct-horse-battery',
  name: 'Ada',
  currency: 'usd',
}

describe('User model', () => {
  it('hashes the password when saving', async () => {
    const user = await User.create(attrs)

    const stored = await User.findById(user._id).select('+password')

    expect(stored?.password).not.toBe(attrs.password)
    expect(await bcrypt.compare(attrs.password, stored?.password ?? '')).toBe(true)
  })

  it('does not select the password unless asked', async () => {
    const user = await User.create(attrs)

    const found = await User.findById(user._id)

    expect(found?.password).toBeUndefined()
  })

  it('normalises the email and currency', async () => {
    const user = await User.create(attrs)

    expect(user.email).toBe('ada@example.com')
    expect(user.currency).toBe('USD')
  })

  it('rejects a second user with the same email', async () => {
    await User.create(attrs)

    await expect(User.create({ ...attrs, email: 'ada@example.com' })).rejects.toMatchObject({
      code: 11000,
    })
  })

  it('does not re-hash an unchanged password on later saves', async () => {
    const user = await User.create(attrs)
    const before = (await User.findById(user._id).select('+password'))?.password

    const loaded = await User.findById(user._id).select('+password')
    if (!loaded) throw new Error('user missing')
    loaded.name = 'Ada L.'
    await loaded.save()

    const after = (await User.findById(user._id).select('+password'))?.password
    expect(after).toBe(before)
  })
})
```

Run: `npx vitest run src/features/auth/user.model.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement constants and models**

`backend/src/features/auth/constants.ts`:

```ts
import { env } from '../../shared/config/env.ts'

// 4 keeps the test suite fast. Development and production always use 12 (CLAUDE.md: cost >= 12).
export const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const RESET_TOKEN_TTL_MS = 15 * 60 * 1000

/** A rotated refresh token reused within this window is a concurrent tab, not theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000
```

`backend/src/features/auth/user.model.ts`:

```ts
import bcrypt from 'bcryptjs'
import { model, Schema, type HydratedDocument } from 'mongoose'
import { BCRYPT_COST } from './constants.ts'

export interface UserAttrs {
  email: string
  /** Holds the bcrypt hash. Hashed by the pre-save hook, never selected by default. */
  password: string
  name: string
  currency: string
  emailVerifiedAt?: Date
}

export type UserDoc = HydratedDocument<UserAttrs>

const userSchema = new Schema<UserAttrs>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    emailVerifiedAt: { type: Date },
  },
  { timestamps: true },
)

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, BCRYPT_COST)
})

export const User = model<UserAttrs>('User', userSchema)
```

`backend/src/features/auth/email-token.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'

export type EmailTokenPurpose = 'verify' | 'reset'

export interface EmailTokenAttrs {
  userId: Types.ObjectId
  purpose: EmailTokenPurpose
  /** SHA-256 of the raw token. The raw token exists only in the email. */
  tokenHash: string
  expiresAt: Date
  usedAt?: Date
}

const emailTokenSchema = new Schema<EmailTokenAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['verify', 'reset'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
})

// MongoDB removes expired tokens in the background.
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const EmailToken = model<EmailTokenAttrs>('EmailToken', emailTokenSchema)
```

`backend/src/features/auth/refresh-token.model.ts`:

```ts
import { model, Schema, type Types } from 'mongoose'

export interface RefreshTokenAttrs {
  userId: Types.ObjectId
  /** All tokens descended from one login share a family, so theft can revoke them together. */
  familyId: string
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
}

const refreshTokenSchema = new Schema<RefreshTokenAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
})

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema)
```

Run: `npx vitest run src/features/auth/user.model.test.ts` → PASS (5 tests).

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): add user, email-token and refresh-token models" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Registration, email verification and resend

**Files:**
- Create: `backend/src/features/auth/auth.schemas.ts`, `auth.emails.ts`, `email-tokens.ts`, `public-user.ts`, `registration.service.ts`, `registration.controller.ts`, `auth.routes.ts`, `index.ts`, `auth.test-helpers.ts`, `auth.registration.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: models and constants from Task 2, `sendMail`, `validate`, `mailRateLimiter`, `authRateLimiter`.
- Produces: `emailSchema`, `passwordSchema`, `currencySchema`, `registerSchema`, `verifyEmailSchema`, `resendVerificationSchema`, `type RegisterInput`; `sendVerificationEmail(to, name, token)`, `sendAlreadyRegisteredEmail(to, name)`, `sendPasswordResetEmail(to, name, token)` (all return `Promise<void>` and never throw); `createEmailToken(userId, purpose, ttlMs): Promise<string>`, `consumeEmailToken(raw, purpose): Promise<Types.ObjectId>` (throws `AppError(400, 'Invalid or expired token')`); `toPublicUser(user): PublicUser`; `register(input)`, `verifyEmail(token)`, `resendVerification(email)`; `authRouter`; test helpers `sendMailMock`, `newUserInput(overrides?)`, `lastMailToken()`, `registerVerified(input?)`, `setCookies(res)`, `refreshCookie(res)`, `VALID_PASSWORD`.

- [ ] **Step 1: Write the test helpers**

`backend/src/features/auth/auth.test-helpers.ts`:

```ts
import request, { type Response } from 'supertest'
import { vi } from 'vitest'
import { app } from '../../app.ts'
import { sendMail } from '../../shared/mailer/mailer.ts'

/** The test file must call vi.mock('../../shared/mailer/mailer.ts', ...) for this to be a mock. */
export const sendMailMock = vi.mocked(sendMail)

export const VALID_PASSWORD = 'correct-horse-battery'

let counter = 0

export interface NewUserInput {
  name: string
  email: string
  password: string
  currency: string
}

export function newUserInput(overrides: Partial<NewUserInput> = {}): NewUserInput {
  counter += 1
  return {
    name: 'Ada Lovelace',
    email: `user${counter}@example.com`,
    password: VALID_PASSWORD,
    currency: 'USD',
    ...overrides,
  }
}

/** The 64-hex token in the link of the most recent email. */
export function lastMailToken(): string {
  const text = sendMailMock.mock.calls.at(-1)?.[0].text ?? ''
  const match = /token=([a-f0-9]{64})/.exec(text)
  if (!match?.[1]) throw new Error('No token found in the last email')
  return match[1]
}

/** All Set-Cookie headers. superagent types headers as strings, but Node delivers an array. */
export function setCookies(res: Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

/** `refresh_token=<value>` from a response that set the refresh cookie. */
export function refreshCookie(res: Response): string {
  const cookie = setCookies(res).find((value) => value.startsWith('refresh_token='))
  if (!cookie) throw new Error('No refresh cookie was set')
  return cookie.split(';')[0] ?? ''
}

/** Registers and verifies a user through the real endpoints. */
export async function registerVerified(input: NewUserInput = newUserInput()): Promise<NewUserInput> {
  await request(app).post('/api/auth/register').send(input).expect(202)
  await request(app).post('/api/auth/verify-email').send({ token: lastMailToken() }).expect(200)
  return input
}
```

- [ ] **Step 2: Write the failing registration tests**

`backend/src/features/auth/auth.registration.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import {
  lastMailToken,
  newUserInput,
  registerVerified,
  sendMailMock,
} from './auth.test-helpers.ts'
import { EmailToken } from './email-token.model.ts'
import { hashToken } from './tokens.ts'
import { User } from './user.model.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)
beforeEach(() => {
  sendMailMock.mockClear()
})

const register = (body: object) => request(app).post('/api/auth/register').send(body)
const verify = (token: string) => request(app).post('/api/auth/verify-email').send({ token })

describe('POST /api/auth/register', () => {
  it('creates an unverified user with a hashed password and emails a verification link', async () => {
    const input = newUserInput()

    const res = await register(input)

    expect(res.status).toBe(202)
    const user = await User.findOne({ email: input.email }).select('+password')
    expect(user?.emailVerifiedAt).toBeUndefined()
    expect(user?.password).toMatch(/^\$2[aby]\$/)
    expect(user?.password).not.toBe(input.password)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({
      to: input.email,
      subject: 'Verify your email',
    })
    expect(sendMailMock.mock.calls[0]?.[0].text).toContain('/verify-email?token=')
  })

  it('never returns the password or a token', async () => {
    const input = newUserInput()

    const res = await register(input)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain(input.password)
    expect(body).not.toMatch(/[a-f0-9]{64}/)
  })

  it('stores only the hash of the verification token', async () => {
    await register(newUserInput())
    const raw = lastMailToken()

    expect(await EmailToken.countDocuments({ tokenHash: raw })).toBe(0)
    expect(await EmailToken.countDocuments({ tokenHash: hashToken(raw), purpose: 'verify' })).toBe(1)
  })

  it('normalises the email address', async () => {
    const input = newUserInput({ email: '  Mixed.Case@Example.COM ' })

    await register(input).expect(202)

    expect(await User.countDocuments({ email: 'mixed.case@example.com' })).toBe(1)
  })

  it.each([
    ['a missing name', { name: '' }],
    ['an invalid email', { email: 'not-an-email' }],
    ['a short password', { password: 'short' }],
    ['a common password', { password: 'password1234' }],
    ['an unsupported currency', { currency: 'ZZZ' }],
    ['a malformed currency', { currency: 'us' }],
  ])('rejects %s with 400 and creates nothing', async (_name, override) => {
    const res = await register(newUserInput(override))

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Validation failed')
    expect(await User.countDocuments()).toBe(0)
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('answers identically for an existing verified email and tells only its owner', async () => {
    const existing = await registerVerified()
    sendMailMock.mockClear()
    const fresh = await register(newUserInput())

    const res = await register({ ...newUserInput(), email: existing.email, name: 'Someone Else' })

    expect(res.status).toBe(fresh.status)
    expect(res.body).toEqual(fresh.body)
    expect(await User.countDocuments({ email: existing.email })).toBe(1)
    expect((await User.findOne({ email: existing.email }))?.name).toBe(existing.name)
    expect(sendMailMock.mock.calls.at(-1)?.[0]).toMatchObject({
      to: existing.email,
      subject: 'You already have an account',
    })
  })

  it('sends a fresh link to an unverified duplicate and invalidates the old one', async () => {
    const input = newUserInput()
    await register(input)
    const oldToken = lastMailToken()

    await register(input).expect(202)
    const newToken = lastMailToken()

    expect(newToken).not.toBe(oldToken)
    await verify(oldToken).expect(400)
    await verify(newToken).expect(200)
  })

  it('still answers 202 when the mail provider is down', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'))
    const input = newUserInput()

    const res = await register(input)

    expect(res.status).toBe(202)
    expect(await User.countDocuments({ email: input.email })).toBe(1)
  })
})

describe('POST /api/auth/verify-email', () => {
  it('marks the email verified', async () => {
    const input = newUserInput()
    await register(input)

    const res = await verify(lastMailToken())

    expect(res.status).toBe(200)
    expect((await User.findOne({ email: input.email }))?.emailVerifiedAt).toBeInstanceOf(Date)
  })

  it('is single use', async () => {
    await register(newUserInput())
    const token = lastMailToken()

    await verify(token).expect(200)
    const second = await verify(token)

    expect(second.status).toBe(400)
    expect(second.body).toEqual({ message: 'Invalid or expired token' })
  })

  it('rejects an unknown token', async () => {
    const res = await verify('a'.repeat(64))

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Invalid or expired token' })
  })

  it('rejects an expired token', async () => {
    await register(newUserInput())
    await EmailToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })

    await verify(lastMailToken()).expect(400)
  })

  it('rejects a malformed token before touching the database', async () => {
    const res = await verify('not-a-token')

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Validation failed')
  })
})

describe('POST /api/auth/resend-verification', () => {
  const resend = (email: string) =>
    request(app).post('/api/auth/resend-verification').send({ email })

  it('emails a new link to an unverified account', async () => {
    const input = newUserInput()
    await register(input)
    const oldToken = lastMailToken()
    sendMailMock.mockClear()

    await resend(input.email).expect(202)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    await verify(oldToken).expect(400)
    await verify(lastMailToken()).expect(200)
  })

  it('answers the same for unverified, verified and unknown emails, and only mails the unverified', async () => {
    const unverified = newUserInput()
    await register(unverified)
    const verified = await registerVerified()
    sendMailMock.mockClear()

    const a = await resend(unverified.email)
    const b = await resend(verified.email)
    const c = await resend('nobody@example.com')

    expect([a.status, b.status, c.status]).toEqual([202, 202, 202])
    expect(b.body).toEqual(a.body)
    expect(c.body).toEqual(a.body)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0]?.[0].to).toBe(unverified.email)
  })
})
```

Run: `npx vitest run src/features/auth/auth.registration.test.ts` → FAIL (`/api/auth/register` is 404 and modules are missing).

- [ ] **Step 3: Implement schemas, emails, token helpers and the public-user mapper**

`backend/src/features/auth/auth.schemas.ts`:

```ts
import { z } from 'zod'
import { isCommonPassword } from './password-policy.ts'

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => !isCommonPassword(value), 'That password is too common')

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => SUPPORTED_CURRENCIES.has(value), 'Unsupported currency')

const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid token')

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: emailSchema,
  password: passwordSchema,
  currency: currencySchema,
})

export const verifyEmailSchema = z.object({ token: tokenSchema })

export const resendVerificationSchema = z.object({ email: emailSchema })

export type RegisterInput = z.infer<typeof registerSchema>
```

`backend/src/features/auth/auth.emails.ts`:

```ts
import { env } from '../../shared/config/env.ts'
import { logger } from '../../shared/logger/logger.ts'
import { sendMail, type MailOptions } from '../../shared/mailer/mailer.ts'

function link(path: string, token?: string): string {
  const url = new URL(path, env.CLIENT_URL)
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

/** Never throws: a mail outage must not change what the API answers (it would leak account state). */
async function sendSafely(options: MailOptions): Promise<void> {
  try {
    await sendMail(options)
  } catch (err) {
    logger.error({ err, subject: options.subject }, 'Failed to send email')
  }
}

export function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'Verify your email',
    text: `Hi ${name},\n\nConfirm your email address to finish creating your account:\n${link('/verify-email', token)}\n\nThis link expires in 24 hours. If you did not sign up, you can ignore this email.`,
  })
}

export function sendAlreadyRegisteredEmail(to: string, name: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'You already have an account',
    text: `Hi ${name},\n\nSomeone tried to sign up with this email address, but you already have an account.\n\nLog in: ${link('/login')}\nForgot your password? ${link('/forgot-password')}\n\nIf this was not you, you can ignore this email.`,
  })
}

export function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  return sendSafely({
    to,
    subject: 'Reset your password',
    text: `Hi ${name},\n\nUse this link to choose a new password:\n${link('/reset-password', token)}\n\nThe link expires in 15 minutes and works once. If you did not ask for this, you can ignore this email.`,
  })
}
```

`backend/src/features/auth/email-tokens.ts`:

```ts
import type { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { EmailToken, type EmailTokenPurpose } from './email-token.model.ts'
import { generateToken, hashToken } from './tokens.ts'

/** Replaces any earlier token of the same purpose and returns the raw token to email. */
export async function createEmailToken(
  userId: Types.ObjectId,
  purpose: EmailTokenPurpose,
  ttlMs: number,
): Promise<string> {
  await EmailToken.deleteMany({ userId, purpose })
  const { raw, hash } = generateToken()
  await EmailToken.create({
    userId,
    purpose,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + ttlMs),
  })
  return raw
}

/** Atomically marks a valid, unused, unexpired token as used and returns its owner. */
export async function consumeEmailToken(
  raw: string,
  purpose: EmailTokenPurpose,
): Promise<Types.ObjectId> {
  const token = await EmailToken.findOneAndUpdate(
    {
      tokenHash: hashToken(raw),
      purpose,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    { usedAt: new Date() },
  )
  if (!token) throw new AppError(400, 'Invalid or expired token')
  return token.userId
}
```

`backend/src/features/auth/public-user.ts`:

```ts
import type { Types } from 'mongoose'

export interface PublicUser {
  id: string
  email: string
  name: string
  currency: string
}

export function toPublicUser(user: {
  _id: Types.ObjectId
  email: string
  name: string
  currency: string
}): PublicUser {
  return { id: user._id.toString(), email: user.email, name: user.name, currency: user.currency }
}
```

- [ ] **Step 4: Implement the service, controller and routes**

`backend/src/features/auth/registration.service.ts`:

```ts
import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/AppError.ts'
import { sendAlreadyRegisteredEmail, sendVerificationEmail } from './auth.emails.ts'
import type { RegisterInput } from './auth.schemas.ts'
import { BCRYPT_COST, VERIFY_TOKEN_TTL_MS } from './constants.ts'
import { consumeEmailToken, createEmailToken } from './email-tokens.ts'
import { User, type UserDoc } from './user.model.ts'

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000
}

async function sendVerification(user: UserDoc): Promise<void> {
  const token = await createEmailToken(user._id, 'verify', VERIFY_TOKEN_TTL_MS)
  await sendVerificationEmail(user.email, user.name, token)
}

async function handleExistingAccount(user: UserDoc, submittedPassword: string): Promise<void> {
  // Same bcrypt work as creating an account, so response time does not reveal that it exists.
  await bcrypt.hash(submittedPassword, BCRYPT_COST)
  if (user.emailVerifiedAt) {
    await sendAlreadyRegisteredEmail(user.email, user.name)
  } else {
    await sendVerification(user)
  }
}

/** Always resolves the same way whether or not the email is already registered. */
export async function register(input: RegisterInput): Promise<void> {
  const existing = await User.findOne({ email: input.email })
  if (existing) {
    await handleExistingAccount(existing, input.password)
    return
  }

  try {
    await sendVerification(await User.create(input))
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    // Two sign-ups raced. Treat the loser as a duplicate.
    const raced = await User.findOne({ email: input.email })
    if (raced) await handleExistingAccount(raced, input.password)
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeEmailToken(token, 'verify')
  const result = await User.updateOne({ _id: userId }, { emailVerifiedAt: new Date() })
  if (result.matchedCount === 0) throw new AppError(400, 'Invalid or expired token')
}

export async function resendVerification(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerifiedAt: { $exists: false } })
  if (user) await sendVerification(user)
}
```

`backend/src/features/auth/registration.controller.ts`:

```ts
import type { Request, Response } from 'express'
import type { RegisterInput } from './auth.schemas.ts'
import * as registrationService from './registration.service.ts'

const CHECK_INBOX = 'Check your inbox for a message with the next steps.'

export async function register(req: Request, res: Response) {
  await registrationService.register(req.body as RegisterInput)
  res.status(202).json({ message: CHECK_INBOX })
}

export async function verifyEmail(req: Request, res: Response) {
  await registrationService.verifyEmail((req.body as { token: string }).token)
  res.json({ message: 'Your email is verified. You can log in now.' })
}

export async function resendVerification(req: Request, res: Response) {
  await registrationService.resendVerification((req.body as { email: string }).email)
  res.status(202).json({ message: CHECK_INBOX })
}
```

`backend/src/features/auth/auth.routes.ts`:

```ts
import { Router } from 'express'
import { authRateLimiter, mailRateLimiter } from '../../shared/middleware/rateLimiters.ts'
import { validate } from '../../shared/middleware/validate.ts'
import { registerSchema, resendVerificationSchema, verifyEmailSchema } from './auth.schemas.ts'
import { register, resendVerification, verifyEmail } from './registration.controller.ts'

export const authRouter = Router()

authRouter.post('/register', mailRateLimiter, validate({ body: registerSchema }), register)
authRouter.post('/verify-email', authRateLimiter, validate({ body: verifyEmailSchema }), verifyEmail)
authRouter.post(
  '/resend-verification',
  mailRateLimiter,
  validate({ body: resendVerificationSchema }),
  resendVerification,
)
```

`backend/src/features/auth/index.ts`:

```ts
export { authRouter } from './auth.routes.ts'
```

In `backend/src/app.ts` add `import { authRouter } from './features/auth/index.ts'` (above the health import, alphabetical) and mount it under the health line:

```ts
app.use('/api/auth', authRouter)
```

Run: `npx vitest run src/features/auth/auth.registration.test.ts` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): add registration, email verification and resend" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Authenticated-user helper and the `/me` endpoint

**Files:**
- Create: `backend/src/shared/auth/requestUser.ts`, `requestUser.test.ts`, `backend/src/features/auth/profile.service.ts`, `profile.controller.ts`
- Modify: `backend/src/features/auth/auth.routes.ts`, `docs/plans/00-overview.md` (shared helper table)

**Interfaces:**
- Produces: `authUserId(req: Request): string` (throws `AppError(401)` if `requireAuth` did not run); `getMe(userId: string): Promise<PublicUser>`; route `GET /api/auth/me`.

`authUserId` replaces `req.user!.id` everywhere. It is needed by every tenant slice, so it lives in `shared/`.

- [ ] **Step 1: Write the failing helper test**

`backend/src/shared/auth/requestUser.test.ts`:

```ts
import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { AppError } from '../errors/AppError.ts'
import { authUserId } from './requestUser.ts'

describe('authUserId', () => {
  it('returns the id set by requireAuth', () => {
    expect(authUserId({ user: { id: 'abc' } } as unknown as Request)).toBe('abc')
  })

  it('throws 401 when there is no authenticated user', () => {
    const withoutUser = {} as unknown as Request

    expect(() => authUserId(withoutUser)).toThrow(AppError)
    expect(() => authUserId(withoutUser)).toThrow(expect.objectContaining({ statusCode: 401 }))
  })
})
```

Run → FAIL. Implement `backend/src/shared/auth/requestUser.ts`:

```ts
import type { Request } from 'express'
import { AppError } from '../errors/AppError.ts'

/** The authenticated user's id. Never read a user id from the request body, params or query. */
export function authUserId(req: Request): string {
  if (!req.user) throw new AppError(401, 'Not authorized')
  return req.user.id
}
```

Run → PASS.

- [ ] **Step 2: Add `getMe` (test comes with Task 5's session tests; here only the wiring)**

`backend/src/features/auth/profile.service.ts`:

```ts
import { AppError } from '../../shared/errors/AppError.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { User } from './user.model.ts'

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId).lean()
  if (!user) throw new AppError(401, 'Not authorized')
  return toPublicUser(user)
}
```

`backend/src/features/auth/profile.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import * as profileService from './profile.service.ts'

export async function me(req: Request, res: Response) {
  res.json({ user: await profileService.getMe(authUserId(req)) })
}
```

In `auth.routes.ts` add `import { requireAuth } from '../../shared/middleware/requireAuth.ts'` and `import { me } from './profile.controller.ts'`, then append:

```ts
authRouter.get('/me', requireAuth, me)
```

In `docs/plans/00-overview.md`, in the "Shared backend helpers" table add a row: `authUserId` | `shared/auth/requestUser.ts` | `(req: Request) => string`.

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend docs
git commit -m "feat(auth): add authUserId helper and GET /me" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Login, refresh rotation and logout

**Files:**
- Create: `backend/src/features/auth/session.service.ts`, `session-response.ts`, `session.controller.ts`, `auth.session.test.ts`
- Modify: `backend/src/features/auth/auth.schemas.ts` (append), `auth.routes.ts`

**Interfaces:**
- Consumes: `RefreshToken`, `User`, `signAccessToken`, `env.REFRESH_TOKEN_TTL_DAYS`, `REFRESH_REUSE_GRACE_MS`, cookie helpers.
- Produces: `type Session = { accessToken: string; user: PublicUser; refreshToken: string; refreshExpiresAt: Date }`; `startSession(user, familyId?): Promise<Session>`; `login(email, password): Promise<Session>`; `refreshSession(rawToken: string | undefined): Promise<Session>`; `logout(rawToken: string | undefined): Promise<void>`; `revokeAllSessions(userId: Types.ObjectId): Promise<void>`; `sendSession(res, session, status?)`; routes `POST /login`, `/refresh`, `/logout`; `loginSchema`, `type LoginInput`.

- [ ] **Step 1: Write the failing session tests**

`backend/src/features/auth/auth.session.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { verifyAccessToken } from '../../shared/auth/token.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import {
  newUserInput,
  refreshCookie,
  registerVerified,
  sendMailMock,
  setCookies,
  type NewUserInput,
} from './auth.test-helpers.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { hashToken } from './tokens.ts'
import { User } from './user.model.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)
beforeEach(() => {
  sendMailMock.mockClear()
})

const login = (user: Pick<NewUserInput, 'email' | 'password'>) =>
  request(app).post('/api/auth/login').send({ email: user.email, password: user.password })

const rawValue = (cookie: string) => cookie.slice('refresh_token='.length)
const refreshWith = (cookie: string) => request(app).post('/api/auth/refresh').set('Cookie', cookie)

describe('POST /api/auth/login', () => {
  it('refuses to log in an unverified account, but only after the password was right', async () => {
    const user = newUserInput()
    await request(app).post('/api/auth/register').send(user).expect(202)

    const wrong = await login({ email: user.email, password: 'wrong-password-123' })
    const right = await login(user)

    expect(wrong.status).toBe(401)
    expect(right.status).toBe(403)
    expect(right.body).toEqual({ message: 'Please verify your email before logging in' })
  })

  it('answers 401 with the same body for a wrong password and an unknown email', async () => {
    const user = await registerVerified()

    const wrongPassword = await login({ email: user.email, password: 'wrong-password-123' })
    const unknownEmail = await login({ email: 'nobody@example.com', password: 'wrong-password-123' })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(unknownEmail.body).toEqual(wrongPassword.body)
    expect(wrongPassword.body).toEqual({ message: 'Invalid email or password' })
  })

  it('returns an access token, the public user and an httpOnly refresh cookie', async () => {
    const user = await registerVerified()

    const res = await login(user)

    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({
      id: expect.stringMatching(/^[a-f\d]{24}$/),
      email: user.email,
      name: user.name,
      currency: user.currency,
    })
    expect(verifyAccessToken(res.body.accessToken)?.sub).toBe(res.body.user.id)
    expect(JSON.stringify(res.body)).not.toContain(user.password)
    const setCookie = setCookies(res).find((c) => c.startsWith('refresh_token=')) ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/api/auth')
    expect(setCookie).toContain('SameSite=Lax')
  })

  it('stores only the hash of the refresh token', async () => {
    const user = await registerVerified()

    const res = await login(user)

    const raw = rawValue(refreshCookie(res))
    expect(await RefreshToken.countDocuments({ tokenHash: raw })).toBe(0)
    expect(await RefreshToken.countDocuments({ tokenHash: hashToken(raw) })).toBe(1)
  })

  it('rejects a malformed body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/auth/me', () => {
  it('requires a valid access token', async () => {
    await request(app).get('/api/auth/me').expect(401)
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer nonsense').expect(401)
  })

  it('returns the current user', async () => {
    const user = await registerVerified()
    const { body } = await login(user)

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(user.email)
  })
})

describe('POST /api/auth/refresh', () => {
  it('returns a new access token and rotates the cookie', async () => {
    const user = await registerVerified()
    const cookieA = refreshCookie(await login(user))

    const res = await refreshWith(cookieA)

    expect(res.status).toBe(200)
    expect(verifyAccessToken(res.body.accessToken)).not.toBeNull()
    expect(res.body.user.email).toBe(user.email)
    expect(refreshCookie(res)).not.toBe(cookieA)
  })

  it('rejects a missing, garbage or expired cookie', async () => {
    const user = await registerVerified()
    const cookie = refreshCookie(await login(user))

    await request(app).post('/api/auth/refresh').expect(401)
    await refreshWith('refresh_token=garbage').expect(401)

    await RefreshToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })
    await refreshWith(cookie).expect(401)
  })

  it('answers 401 for a reused token within the grace period but keeps the new session alive', async () => {
    const user = await registerVerified()
    const cookieA = refreshCookie(await login(user))
    const cookieB = refreshCookie(await refreshWith(cookieA))

    await refreshWith(cookieA).expect(401)

    await refreshWith(cookieB).expect(200)
  })

  it('revokes the whole family when a rotated token is reused after the grace period', async () => {
    const user = await registerVerified()
    const cookieA = refreshCookie(await login(user))
    const cookieB = refreshCookie(await refreshWith(cookieA))
    await RefreshToken.updateOne(
      { tokenHash: hashToken(rawValue(cookieA)) },
      { revokedAt: new Date(Date.now() - 60_000) },
    )

    await refreshWith(cookieA).expect(401)

    await refreshWith(cookieB).expect(401)
  })

  it('fails once the user no longer exists', async () => {
    const user = await registerVerified()
    const cookie = refreshCookie(await login(user))
    await User.deleteMany({})

    await refreshWith(cookie).expect(401)
  })

  it('keeps separate logins in separate families', async () => {
    const user = await registerVerified()
    const phone = refreshCookie(await login(user))
    const laptop = refreshCookie(await login(user))

    await refreshWith(phone).expect(200)

    await refreshWith(laptop).expect(200)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const user = await registerVerified()
    const cookie = refreshCookie(await login(user))

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie)

    expect(res.status).toBe(204)
    const cleared = setCookies(res).find((c) => c.startsWith('refresh_token=;')) ?? ''
    expect(cleared).toContain('Path=/api/auth')
    await refreshWith(cookie).expect(401)
  })

  it('succeeds even when there is no cookie', async () => {
    await request(app).post('/api/auth/logout').expect(204)
  })
})
```

Run: `npx vitest run src/features/auth/auth.session.test.ts` → FAIL (404 on `/login`).

- [ ] **Step 2: Append the login schema**

Append to `backend/src/features/auth/auth.schemas.ts`:

```ts
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export type LoginInput = z.infer<typeof loginSchema>
```

- [ ] **Step 3: Implement the session service**

`backend/src/features/auth/session.service.ts`:

```ts
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import type { Types } from 'mongoose'
import { signAccessToken } from '../../shared/auth/token.ts'
import { env } from '../../shared/config/env.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { BCRYPT_COST, REFRESH_REUSE_GRACE_MS } from './constants.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { generateToken, hashToken } from './tokens.ts'
import { User } from './user.model.ts'

export interface Session {
  accessToken: string
  user: PublicUser
  refreshToken: string
  refreshExpiresAt: Date
}

const DAY_MS = 86_400_000

// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST)

/** Issues an access token and a new refresh token, in an existing family or a new one. */
export async function startSession(
  user: { _id: Types.ObjectId; email: string; name: string; currency: string },
  familyId: string = randomBytes(16).toString('hex'),
): Promise<Session> {
  const { raw, hash } = generateToken()
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS)
  await RefreshToken.create({
    userId: user._id,
    familyId,
    tokenHash: hash,
    expiresAt: refreshExpiresAt,
  })
  return {
    accessToken: signAccessToken(user._id.toString()),
    user: toPublicUser(user),
    refreshToken: raw,
    refreshExpiresAt,
  }
}

export async function login(email: string, password: string): Promise<Session> {
  const user = await User.findOne({ email }).select('+password')
  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH)
  if (!user || !passwordMatches) throw new AppError(401, 'Invalid email or password')
  if (!user.emailVerifiedAt) throw new AppError(403, 'Please verify your email before logging in')
  return startSession(user)
}

/**
 * Rotates a refresh token. A token can be used once: presenting an already-rotated token after the
 * grace period is treated as theft and revokes the whole family.
 */
export async function refreshSession(rawToken: string | undefined): Promise<Session> {
  if (!rawToken) throw new AppError(401, 'Not authorized')
  const tokenHash = hashToken(rawToken)

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { revokedAt: new Date() },
  )

  if (!claimed) {
    const known = await RefreshToken.findOne({ tokenHash })
    if (known?.revokedAt && Date.now() - known.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await RefreshToken.updateMany(
        { familyId: known.familyId, revokedAt: { $exists: false } },
        { revokedAt: new Date() },
      )
    }
    throw new AppError(401, 'Not authorized')
  }

  const user = await User.findById(claimed.userId)
  if (!user?.emailVerifiedAt) throw new AppError(401, 'Not authorized')
  return startSession(user, claimed.familyId)
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  )
}

export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: { $exists: false } }, { revokedAt: new Date() })
}
```

- [ ] **Step 4: Implement the controller, response helper and routes**

`backend/src/features/auth/session-response.ts`:

```ts
import type { Response } from 'express'
import { setRefreshCookie } from './cookies.ts'
import type { Session } from './session.service.ts'

/** Sets the refresh cookie and sends the access token. The refresh token never appears in the body. */
export function sendSession(res: Response, session: Session, status = 200): void {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt)
  res.status(status).json({ accessToken: session.accessToken, user: session.user })
}
```

`backend/src/features/auth/session.controller.ts`:

```ts
import type { Request, Response } from 'express'
import type { LoginInput } from './auth.schemas.ts'
import { clearRefreshCookie, readRefreshCookie } from './cookies.ts'
import { sendSession } from './session-response.ts'
import * as sessionService from './session.service.ts'

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput
  sendSession(res, await sessionService.login(email, password))
}

export async function refresh(req: Request, res: Response) {
  sendSession(res, await sessionService.refreshSession(readRefreshCookie(req)))
}

export async function logout(req: Request, res: Response) {
  await sessionService.logout(readRefreshCookie(req))
  clearRefreshCookie(res)
  res.status(204).end()
}
```

In `auth.routes.ts` add `import { loginSchema } from './auth.schemas.ts'` (extend the existing schema import), `import { login, logout, refresh } from './session.controller.ts'`, and append:

```ts
authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), login)
authRouter.post('/refresh', authRateLimiter, refresh)
authRouter.post('/logout', logout)
```

Run: `npx vitest run src/features/auth/auth.session.test.ts` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): add login, rotating refresh tokens and logout" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Password reset, password change and profile update

**Files:**
- Create: `backend/src/features/auth/password.service.ts`, `password.controller.ts`, `auth.password.test.ts`, `auth.profile.test.ts`
- Modify: `auth.schemas.ts` (append), `auth.routes.ts`, `profile.service.ts`, `profile.controller.ts`

**Interfaces:**
- Consumes: `createEmailToken`, `consumeEmailToken`, `sendPasswordResetEmail`, `startSession`, `revokeAllSessions`, `sendSession`, `authUserId`.
- Produces: `forgotPassword(email)`, `resetPassword(token, password)`, `changePassword(userId, currentPassword, newPassword): Promise<Session>`, `updateProfile(userId, { name }): Promise<PublicUser>`; routes `POST /forgot-password`, `/reset-password`, `/change-password`, `PATCH /me`.

- [ ] **Step 1: Write the failing password tests**

`backend/src/features/auth/auth.password.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import {
  lastMailToken,
  newUserInput,
  refreshCookie,
  registerVerified,
  sendMailMock,
  VALID_PASSWORD,
} from './auth.test-helpers.ts'
import { EmailToken } from './email-token.model.ts'
import { hashToken } from './tokens.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)
beforeEach(() => {
  sendMailMock.mockClear()
})

const NEW_PASSWORD = 'a-brand-new-passphrase'

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password })
const forgot = (email: string) => request(app).post('/api/auth/forgot-password').send({ email })
const reset = (token: string, password: string) =>
  request(app).post('/api/auth/reset-password').send({ token, password })

describe('POST /api/auth/forgot-password', () => {
  it('answers the same for a verified, an unverified and an unknown email, and mails only the verified one', async () => {
    const verified = await registerVerified()
    const unverified = newUserInput()
    await request(app).post('/api/auth/register').send(unverified).expect(202)
    sendMailMock.mockClear()

    const a = await forgot(verified.email)
    const b = await forgot(unverified.email)
    const c = await forgot('nobody@example.com')

    expect([a.status, b.status, c.status]).toEqual([202, 202, 202])
    expect(b.body).toEqual(a.body)
    expect(c.body).toEqual(a.body)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock.mock.calls[0]?.[0]).toMatchObject({
      to: verified.email,
      subject: 'Reset your password',
    })
  })

  it('stores only the hash of the reset token and expires it within 15 minutes', async () => {
    const user = await registerVerified()

    await forgot(user.email)

    const raw = lastMailToken()
    const stored = await EmailToken.findOne({ tokenHash: hashToken(raw) })
    expect(stored?.purpose).toBe('reset')
    expect(await EmailToken.countDocuments({ tokenHash: raw })).toBe(0)
    const expiresAt = stored?.expiresAt.getTime() ?? Number.POSITIVE_INFINITY
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000)
  })
})

describe('POST /api/auth/reset-password', () => {
  it('sets the new password, and the old one stops working', async () => {
    const user = await registerVerified()
    await forgot(user.email)

    await reset(lastMailToken(), NEW_PASSWORD).expect(200)

    await login(user.email, NEW_PASSWORD).expect(200)
    await login(user.email, VALID_PASSWORD).expect(401)
  })

  it('is single use', async () => {
    const user = await registerVerified()
    await forgot(user.email)
    const token = lastMailToken()

    await reset(token, NEW_PASSWORD).expect(200)
    const second = await reset(token, 'yet-another-passphrase')

    expect(second.status).toBe(400)
    expect(second.body).toEqual({ message: 'Invalid or expired token' })
  })

  it('rejects an expired token', async () => {
    const user = await registerVerified()
    await forgot(user.email)
    await EmailToken.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })

    await reset(lastMailToken(), NEW_PASSWORD).expect(400)
  })

  it('does not accept an email-verification token', async () => {
    const input = newUserInput()
    await request(app).post('/api/auth/register').send(input).expect(202)

    await reset(lastMailToken(), NEW_PASSWORD).expect(400)
  })

  it('does not burn the token when the new password is rejected', async () => {
    const user = await registerVerified()
    await forgot(user.email)
    const token = lastMailToken()

    await reset(token, 'short').expect(400)
    await reset(token, 'password1234').expect(400)

    await reset(token, NEW_PASSWORD).expect(200)
  })

  it('signs the user out everywhere', async () => {
    const user = await registerVerified()
    const cookie = refreshCookie(await login(user.email, user.password))
    await forgot(user.email)

    await reset(lastMailToken(), NEW_PASSWORD).expect(200)

    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401)
  })
})

describe('POST /api/auth/change-password', () => {
  const change = (accessToken: string, body: object) =>
    request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${accessToken}`).send(body)

  it('requires authentication', async () => {
    await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: VALID_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(401)
  })

  it('answers 403, not 401, when the current password is wrong, and changes nothing', async () => {
    const user = await registerVerified()
    const { body } = await login(user.email, user.password)

    const res = await change(body.accessToken, {
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ message: 'Current password is incorrect' })
    await login(user.email, VALID_PASSWORD).expect(200)
  })

  it('rejects a weak new password', async () => {
    const user = await registerVerified()
    const { body } = await login(user.email, user.password)

    await change(body.accessToken, { currentPassword: VALID_PASSWORD, newPassword: 'short' }).expect(400)
  })

  it('changes the password, ends other sessions and keeps this one signed in', async () => {
    const user = await registerVerified()
    const other = refreshCookie(await login(user.email, user.password))
    const { body } = await login(user.email, user.password)

    const res = await change(body.accessToken, {
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toEqual(expect.any(String))
    await login(user.email, NEW_PASSWORD).expect(200)
    await login(user.email, VALID_PASSWORD).expect(401)
    await request(app).post('/api/auth/refresh').set('Cookie', other).expect(401)
    await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(res)).expect(200)
  })
})
```

`backend/src/features/auth/auth.profile.test.ts`:

```ts
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { registerVerified } from './auth.test-helpers.ts'
import { User } from './user.model.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

async function loggedIn() {
  const user = await registerVerified()
  const { body } = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: user.password })
  return { user, token: body.accessToken as string }
}

describe('PATCH /api/auth/me', () => {
  it('requires authentication', async () => {
    await request(app).patch('/api/auth/me').send({ name: 'X' }).expect(401)
  })

  it('updates the name', async () => {
    const { token } = await loggedIn()

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  Ada L.  ' })

    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('Ada L.')
  })

  it('rejects a blank name', async () => {
    const { token } = await loggedIn()

    await request(app).patch('/api/auth/me').set('Authorization', `Bearer ${token}`).send({ name: '  ' }).expect(400)
  })

  it('ignores fields it does not own (email, currency, password, verification)', async () => {
    const { user, token } = await loggedIn()

    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ada', email: 'evil@example.com', currency: 'EUR', emailVerifiedAt: null })
      .expect(200)

    const stored = await User.findOne({ email: user.email })
    expect(stored?.currency).toBe('USD')
    expect(stored?.emailVerifiedAt).toBeInstanceOf(Date)
    expect(await User.countDocuments({ email: 'evil@example.com' })).toBe(0)
  })
})
```

Run: `npx vitest run src/features/auth/auth.password.test.ts src/features/auth/auth.profile.test.ts` → FAIL (404s).

- [ ] **Step 2: Append the schemas**

Append to `auth.schemas.ts`:

```ts
export const forgotPasswordSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema })

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
})

export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(80) })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
```

- [ ] **Step 3: Implement the password service and controller**

`backend/src/features/auth/password.service.ts`:

```ts
import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/AppError.ts'
import { sendPasswordResetEmail } from './auth.emails.ts'
import { RESET_TOKEN_TTL_MS } from './constants.ts'
import { consumeEmailToken, createEmailToken } from './email-tokens.ts'
import { revokeAllSessions, startSession, type Session } from './session.service.ts'
import { User } from './user.model.ts'

/** Only verified accounts get a link. Resolves the same way for every email. */
export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerifiedAt: { $exists: true } })
  if (!user) return
  const token = await createEmailToken(user._id, 'reset', RESET_TOKEN_TTL_MS)
  await sendPasswordResetEmail(user.email, user.name, token)
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeEmailToken(token, 'reset')
  const user = await User.findById(userId).select('+password')
  if (!user) throw new AppError(400, 'Invalid or expired token')
  user.password = password
  await user.save()
  await revokeAllSessions(user._id)
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  const user = await User.findById(userId).select('+password')
  if (!user) throw new AppError(401, 'Not authorized')
  // 403, not 401: the client treats 401 as "session expired" and would log the user out.
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new AppError(403, 'Current password is incorrect')
  }
  user.password = newPassword
  await user.save()
  await revokeAllSessions(user._id)
  return startSession(user)
}
```

`backend/src/features/auth/password.controller.ts`:

```ts
import type { Request, Response } from 'express'
import { authUserId } from '../../shared/auth/requestUser.ts'
import type { ChangePasswordInput } from './auth.schemas.ts'
import * as passwordService from './password.service.ts'
import { sendSession } from './session-response.ts'

export async function forgotPassword(req: Request, res: Response) {
  await passwordService.forgotPassword((req.body as { email: string }).email)
  res.status(202).json({ message: 'If an account exists for that email, a reset link is on its way.' })
}

export async function resetPassword(req: Request, res: Response) {
  const { token, password } = req.body as { token: string; password: string }
  await passwordService.resetPassword(token, password)
  res.json({ message: 'Your password has been changed. You can log in now.' })
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput
  sendSession(res, await passwordService.changePassword(authUserId(req), currentPassword, newPassword))
}
```

- [ ] **Step 4: Add the profile update**

Append to `backend/src/features/auth/profile.service.ts`:

```ts
export async function updateProfile(userId: string, input: { name: string }): Promise<PublicUser> {
  const user = await User.findByIdAndUpdate(userId, { name: input.name }, { new: true }).lean()
  if (!user) throw new AppError(401, 'Not authorized')
  return toPublicUser(user)
}
```

Append to `backend/src/features/auth/profile.controller.ts` (and add `import type { UpdateProfileInput } from './auth.schemas.ts'`):

```ts
export async function updateMe(req: Request, res: Response) {
  const input = req.body as UpdateProfileInput
  res.json({ user: await profileService.updateProfile(authUserId(req), input) })
}
```

- [ ] **Step 5: Add the routes**

In `auth.routes.ts` extend the schema import with `changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, updateProfileSchema`, import `{ changePassword, forgotPassword, resetPassword } from './password.controller.ts'` and `updateMe` from `./profile.controller.ts` (alongside `me`), then append:

```ts
authRouter.post('/forgot-password', mailRateLimiter, validate({ body: forgotPasswordSchema }), forgotPassword)
authRouter.post('/reset-password', authRateLimiter, validate({ body: resetPasswordSchema }), resetPassword)
authRouter.post(
  '/change-password',
  authRateLimiter,
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePassword,
)
authRouter.patch('/me', requireAuth, validate({ body: updateProfileSchema }), updateMe)
```

Run: `npx vitest run src/features/auth` → PASS.

- [ ] **Step 6: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): add password reset, password change and profile update" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: The auth slice's public API

**Files:**
- Create: `backend/src/features/auth/public-api.ts`, `public-api.test.ts`
- Modify: `backend/src/features/auth/index.ts`

**Interfaces:**
- Produces (exported from `features/auth/index.ts`): `authRouter`, `clearRefreshCookie`, `type UserProfile`, `getUserProfile(userId: string): Promise<UserProfile | null>`, `verifyPassword(userId: string, password: string): Promise<boolean>`, `setUserCurrency(userId: string, currency: string): Promise<void>` (throws a Zod error, so 400, for an unsupported code), `deleteUser(userId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`backend/src/features/auth/public-api.test.ts`:

```ts
import { Types } from 'mongoose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { registerVerified, VALID_PASSWORD } from './auth.test-helpers.ts'
import { EmailToken } from './email-token.model.ts'
import { deleteUser, getUserProfile, setUserCurrency, verifyPassword } from './index.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { User } from './user.model.ts'

vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

async function createUser() {
  const input = await registerVerified()
  const user = await User.findOne({ email: input.email })
  if (!user) throw new Error('user missing')
  return { input, id: user._id.toString() }
}

describe('auth public API', () => {
  it('getUserProfile returns the public fields, or null for an unknown user', async () => {
    const { input, id } = await createUser()

    expect(await getUserProfile(id)).toEqual({
      id,
      email: input.email,
      name: input.name,
      currency: 'USD',
    })
    expect(await getUserProfile(new Types.ObjectId().toString())).toBeNull()
  })

  it('verifyPassword checks the password without exposing the hash', async () => {
    const { id } = await createUser()

    expect(await verifyPassword(id, VALID_PASSWORD)).toBe(true)
    expect(await verifyPassword(id, 'wrong-password-123')).toBe(false)
    expect(await verifyPassword(new Types.ObjectId().toString(), VALID_PASSWORD)).toBe(false)
  })

  it('setUserCurrency updates a supported currency and rejects others', async () => {
    const { id } = await createUser()

    await setUserCurrency(id, 'eur')
    expect((await getUserProfile(id))?.currency).toBe('EUR')

    await expect(setUserCurrency(id, 'ZZZ')).rejects.toThrow()
    expect((await getUserProfile(id))?.currency).toBe('EUR')
  })

  it('deleteUser removes the user, their tokens and their sessions', async () => {
    const { input, id } = await createUser()
    await request(app).post('/api/auth/login').send({ email: input.email, password: input.password })
    expect(await RefreshToken.countDocuments()).toBe(1)

    await deleteUser(id)

    expect(await User.countDocuments()).toBe(0)
    expect(await RefreshToken.countDocuments()).toBe(0)
    expect(await EmailToken.countDocuments()).toBe(0)
  })
})
```

Run → FAIL (`deleteUser` etc. not exported).

- [ ] **Step 2: Implement**

`backend/src/features/auth/public-api.ts`:

```ts
import bcrypt from 'bcryptjs'
import { currencySchema } from './auth.schemas.ts'
import { EmailToken } from './email-token.model.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { User } from './user.model.ts'

export type UserProfile = PublicUser

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await User.findById(userId).lean()
  return user ? toPublicUser(user) : null
}

export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const user = await User.findById(userId).select('+password')
  return user ? bcrypt.compare(password, user.password) : false
}

export async function setUserCurrency(userId: string, currency: string): Promise<void> {
  await User.updateOne({ _id: userId }, { currency: currencySchema.parse(currency) })
}

/** Removes the account and everything the auth slice stores about it. */
export async function deleteUser(userId: string): Promise<void> {
  await Promise.all([RefreshToken.deleteMany({ userId }), EmailToken.deleteMany({ userId })])
  await User.deleteOne({ _id: userId })
}
```

Replace `backend/src/features/auth/index.ts`:

```ts
export { authRouter } from './auth.routes.ts'
export { clearRefreshCookie } from './cookies.ts'
export {
  deleteUser,
  getUserProfile,
  setUserCurrency,
  verifyPassword,
  type UserProfile,
} from './public-api.ts'
```

Run: `npx vitest run src/features/auth/public-api.test.ts` → PASS. (The test imports from `./index.ts`, which is the slice boundary other slices will use.)

- [ ] **Step 3: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add backend
git commit -m "feat(auth): expose profile, password check, currency and delete through the slice API" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Part B: Frontend

All commands in Part B run from `frontend/`. Imports use the `@/` alias; imports inside `features/auth` are relative.

### Task 8: Refresh-on-401 in the shared HTTP client

**Files:**
- Modify: `frontend/src/shared/api/httpClient.ts` (replace), `frontend/src/shared/api/axios-augment.d.ts`
- Test: `frontend/src/shared/api/httpClient.test.ts`

**Interfaces:**
- Consumes: `installColdStartRetry` (M0).
- Produces: `configureAuth({ getToken: () => string | null; onUnauthorized: () => Promise<boolean> })`. When a request that carried a token gets a 401, the client calls `onUnauthorized()` once; if it resolves `true` the request is retried once with the new token, otherwise the original error is rejected. `AxiosRequestConfig` gains `skipAuthRefresh?: boolean` (never try to refresh for this request) and `authRetried?: boolean` (internal).

- [ ] **Step 1: Write the failing tests**

`frontend/src/shared/api/httpClient.test.ts`:

```ts
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAuth, getErrorMessage, httpClient } from './httpClient'

const originalAdapter = httpClient.defaults.adapter

const bearer = (config: InternalAxiosRequestConfig) => String(config.headers.get('Authorization') ?? '')

/** Points the shared client at a fake server. Returns the Authorization header of each call. */
function useServer(statusFor: (config: InternalAxiosRequestConfig) => number): string[] {
  const calls: string[] = []
  const adapter: AxiosAdapter = async (config) => {
    calls.push(bearer(config))
    const status = statusFor(config)
    const response = { data: {}, status, statusText: '', headers: {}, config }
    if (status >= 400) throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, response)
    return response
  }
  httpClient.defaults.adapter = adapter
  return calls
}

afterEach(() => {
  httpClient.defaults.adapter = originalAdapter
  configureAuth({ getToken: () => null, onUnauthorized: async () => false })
})

describe('httpClient auth handling', () => {
  it('sends the bearer token when there is one', async () => {
    const calls = useServer(() => 200)
    configureAuth({ getToken: () => 'abc', onUnauthorized: async () => false })

    await httpClient.get('/things')

    expect(calls).toEqual(['Bearer abc'])
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    let token = 'old'
    const calls = useServer((config) => (bearer(config) === 'Bearer old' ? 401 : 200))
    const refresh = vi.fn(async () => {
      token = 'new'
      return true
    })
    configureAuth({ getToken: () => token, onUnauthorized: refresh })

    const response = await httpClient.get('/things')

    expect(response.status).toBe(200)
    expect(calls).toEqual(['Bearer old', 'Bearer new'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the retry is also unauthorized', async () => {
    const calls = useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => 'tok', onUnauthorized: refresh })

    await expect(httpClient.get('/things')).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls).toHaveLength(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('rejects with the original error when the refresh fails', async () => {
    const calls = useServer(() => 401)
    configureAuth({ getToken: () => 'tok', onUnauthorized: async () => false })

    await expect(httpClient.get('/things')).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls).toHaveLength(1)
  })

  it('never tries to refresh a request marked skipAuthRefresh', async () => {
    useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => 'tok', onUnauthorized: refresh })

    await expect(httpClient.post('/auth/refresh', undefined, { skipAuthRefresh: true })).rejects.toThrow()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refresh anonymous requests such as a wrong-password login', async () => {
    useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => null, onUnauthorized: refresh })

    await expect(httpClient.post('/auth/login', {})).rejects.toThrow()

    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('getErrorMessage', () => {
  it('prefers the API message, then the error message, then a generic one', () => {
    const apiError = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
      status: 409,
      statusText: '',
      data: { message: 'Already exists' },
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    })

    expect(getErrorMessage(apiError)).toBe('Already exists')
    expect(getErrorMessage(new Error('Network Error'))).toBe('Network Error')
    expect(getErrorMessage('nonsense')).toBe('Something went wrong')
  })
})
```

Run: `npx vitest run src/shared/api/httpClient.test.ts` → FAIL (`skipAuthRefresh` is not a known option and `onUnauthorized` has the old shape).

- [ ] **Step 2: Extend the axios config type**

Replace `frontend/src/shared/api/axios-augment.d.ts`:

```ts
import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** How many cold-start retries this request has used. Set by installColdStartRetry. */
    coldStartAttempt?: number
    /** Set on the refresh call itself so a 401 there never triggers another refresh. */
    skipAuthRefresh?: boolean
    /** Set once a request has been retried after a session refresh. */
    authRetried?: boolean
  }
}
```

- [ ] **Step 3: Replace the client**

Replace `frontend/src/shared/api/httpClient.ts`:

```ts
import axios from 'axios'
import { env } from '@/shared/config/env'
import { installColdStartRetry } from './coldStartRetry'

type TokenGetter = () => string | null
/** Tries to obtain a fresh access token. Resolves true when the session was refreshed. */
type UnauthorizedHandler = () => Promise<boolean>

let getAccessToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = async () => false

/**
 * Lets the auth slice plug in token handling without shared/ depending on features/.
 */
export function configureAuth(options: {
  getToken: TokenGetter
  onUnauthorized: UnauthorizedHandler
}) {
  getAccessToken = options.getToken
  onUnauthorized = options.onUnauthorized
}

export const httpClient = axios.create({
  baseURL: env.VITE_API_URL,
  withCredentials: true,
})

httpClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const config = error.config
      // Only requests that carried a token can have an expired session; a bare 401 (wrong
      // password) must not trigger a refresh.
      if (config && !config.skipAuthRefresh && !config.authRetried && config.headers.Authorization) {
        config.authRetried = true
        if (await onUnauthorized()) return httpClient.request(config)
      }
    }
    return Promise.reject(error)
  },
)

installColdStartRetry(httpClient)

/** Extracts the `{ message }` from an API error, falling back to a generic message. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? error.message
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
```

Run: `npx vitest run src/shared/api` → PASS (the new file and the M0 cold-start file).

- [ ] **Step 4: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(frontend): refresh the session once on 401 and retry the request" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Session store, API functions and session logic

**Files:**
- Create: `frontend/src/features/auth/types.ts`, `store/authStore.ts`, `api/authApi.ts`, `api/hooks.ts`, `session.ts`, `session.test.ts`

**Interfaces:**
- Consumes: `httpClient`, `configureAuth`, `warmUpServer`, `queryClient`.
- Produces: `SessionUser = { id; email; name; currency }`, `SessionResponse = { accessToken; user }`; `useAuthStore` (`status: 'unknown' | 'authenticated' | 'anonymous'`, `accessToken`, `user`, `setSession`, `setUser`, `clear`); API functions `register`, `verifyEmail`, `resendVerification`, `login`, `refresh`, `logout`, `forgotPassword`, `resetPassword`, `changePassword`, `updateProfile`; session functions `refreshSession(): Promise<boolean>` (single-flight), `endSession(): void`, `logoutUser(): Promise<void>`, `bootstrapSession(): Promise<void>`, `initAuth(): void`, `updateSessionUser(partial): void`; hooks `useSessionUser`, `useRegister`, `useVerifyEmail`, `useResendVerification`, `useLogin`, `useLogout`, `useForgotPassword`, `useResetPassword`, `useChangePassword`, `useUpdateProfile`.

- [ ] **Step 1: Write the types, store and API functions**

`frontend/src/features/auth/types.ts`:

```ts
export interface SessionUser {
  id: string
  email: string
  name: string
  currency: string
}

export interface SessionResponse {
  accessToken: string
  user: SessionUser
}
```

`frontend/src/features/auth/store/authStore.ts`:

```ts
import { create } from 'zustand'
import type { SessionResponse, SessionUser } from '../types'

type Status = 'unknown' | 'authenticated' | 'anonymous'

interface AuthState {
  status: Status
  /** In memory only. Never written to localStorage, sessionStorage or a readable cookie. */
  accessToken: string | null
  user: SessionUser | null
  setSession: (session: SessionResponse) => void
  setUser: (user: SessionUser) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ status: 'authenticated', accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}))
```

`frontend/src/features/auth/api/authApi.ts`:

```ts
import { httpClient } from '@/shared/api/httpClient'
import type { SessionResponse, SessionUser } from '../types'

export async function register(input: {
  name: string
  email: string
  password: string
  currency: string
}): Promise<void> {
  await httpClient.post('/auth/register', input)
}

export async function verifyEmail(input: { token: string }): Promise<void> {
  await httpClient.post('/auth/verify-email', input)
}

export async function resendVerification(input: { email: string }): Promise<void> {
  await httpClient.post('/auth/resend-verification', input)
}

export async function login(input: { email: string; password: string }): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/login', input)
  return data
}

/** Uses the refresh cookie. skipAuthRefresh stops a 401 here from triggering another refresh. */
export async function refresh(): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/refresh', undefined, {
    skipAuthRefresh: true,
  })
  return data
}

export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout', undefined, { skipAuthRefresh: true })
}

export async function forgotPassword(input: { email: string }): Promise<void> {
  await httpClient.post('/auth/forgot-password', input)
}

export async function resetPassword(input: { token: string; password: string }): Promise<void> {
  await httpClient.post('/auth/reset-password', input)
}

export async function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<SessionResponse> {
  const { data } = await httpClient.post<SessionResponse>('/auth/change-password', input)
  return data
}

export async function updateProfile(input: { name: string }): Promise<SessionUser> {
  const { data } = await httpClient.patch<{ user: SessionUser }>('/auth/me', input)
  return data.user
}
```

- [ ] **Step 2: Write the failing session tests**

`frontend/src/features/auth/session.test.ts`:

```ts
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { logoutUser, refreshSession, updateSessionUser } from './session'
import { useAuthStore } from './store/authStore'

vi.mock('./api/authApi')

const session = {
  accessToken: 'token-1',
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
}

function httpError(status: number) {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null })
})

describe('refreshSession', () => {
  it('stores the new session', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    expect(await refreshSession()).toBe(true)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'token-1',
      user: session.user,
    })
  })

  it('shares one request between concurrent callers', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()])

    expect(results).toEqual([true, true, true])
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('makes a new request once the previous one has finished', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await refreshSession()
    await refreshSession()

    expect(authApi.refresh).toHaveBeenCalledTimes(2)
  })

  it('ends the session and clears every cached query when the server says 401', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(401))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      accessToken: null,
      user: null,
    })
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })

  it('keeps an existing session when the failure is only the network or a gateway', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['still mine'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(504))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(queryClient.getQueryData(['tasks'])).toEqual(['still mine'])
  })

  it('falls back to anonymous at start-up when the server cannot be reached', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('Network Error'))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})

describe('logoutUser', () => {
  it('clears the session and the query cache even when the request fails', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.logout).mockRejectedValue(new Error('Network Error'))

    await logoutUser()

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })
})

describe('updateSessionUser', () => {
  it('merges changes into the signed-in user', () => {
    useAuthStore.getState().setSession(session)

    updateSessionUser({ name: 'Ada L.' })

    expect(useAuthStore.getState().user).toEqual({ ...session.user, name: 'Ada L.' })
  })

  it('does nothing when nobody is signed in', () => {
    updateSessionUser({ name: 'Nobody' })

    expect(useAuthStore.getState().user).toBeNull()
  })
})
```

Run: `npx vitest run src/features/auth/session.test.ts` → FAIL (`./session` missing).

- [ ] **Step 3: Implement the session logic**

`frontend/src/features/auth/session.ts`:

```ts
import axios from 'axios'
import { configureAuth } from '@/shared/api/httpClient'
import { warmUpServer } from '@/shared/api/warmUp'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useAuthStore } from './store/authStore'
import type { SessionUser } from './types'

let inFlight: Promise<boolean> | null = null
let bootstrapped: Promise<void> | null = null

/** Signs out locally and drops every cached query, so the next user never sees this user's data. */
export function endSession(): void {
  useAuthStore.getState().clear()
  queryClient.clear()
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request
 * (refresh tokens are single use). Resolves true when the session was renewed.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= authApi
    .refresh()
    .then(
      (session) => {
        useAuthStore.getState().setSession(session)
        return true
      },
      (error: unknown) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          endSession()
        } else if (useAuthStore.getState().status === 'unknown') {
          // Server unreachable at start-up: show the login page rather than a spinner forever.
          useAuthStore.getState().clear()
        }
        return false
      },
    )
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Wakes the backend if it is asleep, then tries to restore the session from the cookie. */
export function bootstrapSession(): Promise<void> {
  bootstrapped ??= warmUpServer().then(async () => {
    await refreshSession()
  })
  return bootstrapped
}

export async function logoutUser(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    // The user asked to leave. Local state is cleared below whatever the server said.
  } finally {
    endSession()
  }
}

export function updateSessionUser(partial: Partial<SessionUser>): void {
  const { user, setUser } = useAuthStore.getState()
  if (user) setUser({ ...user, ...partial })
}

/** Connects the shared HTTP client to the session. Call once at start-up. */
export function initAuth(): void {
  configureAuth({
    getToken: () => useAuthStore.getState().accessToken,
    onUnauthorized: refreshSession,
  })
}
```

Run: `npx vitest run src/features/auth/session.test.ts` → PASS (9 tests).

- [ ] **Step 4: Implement the hooks**

`frontend/src/features/auth/api/hooks.ts`:

```ts
import { useMutation } from '@tanstack/react-query'
import { queryClient } from '@/shared/lib/queryClient'
import { logoutUser } from '../session'
import { useAuthStore } from '../store/authStore'
import type { SessionUser } from '../types'
import * as authApi from './authApi'

export function useSessionUser(): SessionUser | null {
  return useAuthStore((state) => state.user)
}

export function useRegister() {
  return useMutation({ mutationFn: authApi.register })
}

export function useVerifyEmail() {
  return useMutation({ mutationFn: authApi.verifyEmail })
}

export function useResendVerification() {
  return useMutation({ mutationFn: authApi.resendVerification })
}

export function useLogin() {
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      // A different person may be logging in on a browser the previous user just left.
      queryClient.clear()
      useAuthStore.getState().setSession(session)
    },
  })
}

export function useLogout() {
  return useMutation({ mutationFn: logoutUser })
}

export function useForgotPassword() {
  return useMutation({ mutationFn: authApi.forgotPassword })
}

export function useResetPassword() {
  return useMutation({ mutationFn: authApi.resetPassword })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: (session) => useAuthStore.getState().setSession(session),
  })
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (user) => useAuthStore.getState().setUser(user),
  })
}
```

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(auth): add session store, API functions and single-flight refresh" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Login and register pages

**Files:**
- Create: `frontend/src/features/auth/schemas.ts`, `currencies.ts`, `components/AuthLayout.tsx`, `auth.css`, `pages/LoginPage.tsx`, `pages/LoginPage.test.tsx`, `pages/RegisterPage.tsx`, `pages/RegisterPage.test.tsx`

**Interfaces:**
- Produces: form schemas `loginFormSchema`, `registerFormSchema`, `forgotFormSchema`, `resetFormSchema`, `resendFormSchema` and their types `LoginForm`, `RegisterForm`, `ForgotForm`, `ResetForm`, `ResendForm`; `CURRENCY_OPTIONS: { code: string; label: string }[]`; `AuthLayout({ title, children, footer? })`; default-exported pages `LoginPage`, `RegisterPage`.

- [ ] **Step 1: Write the failing LoginPage test**

`frontend/src/features/auth/pages/LoginPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import { useAuthStore } from '../store/authStore'
import LoginPage from './LoginPage'

vi.mock('../api/authApi')

const session = {
  accessToken: 'token',
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
}

function apiError(status: number, message: string) {
  return new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: { message },
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<p>Dashboard home</p>} />
    </Routes>,
    { route: '/login' },
  )
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'a-long-passphrase')
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null })
})

describe('LoginPage', () => {
  it('shows validation errors and does not call the API for an empty form', async () => {
    renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('logs in, stores the session in memory and goes to the dashboard', async () => {
    vi.mocked(authApi.login).mockResolvedValue(session)
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByText('Dashboard home')).toBeInTheDocument()
    expect(vi.mocked(authApi.login).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
      password: 'a-long-passphrase',
    })
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: 'token' })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('drops cached data from a previous user on the same browser', async () => {
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.login).mockResolvedValue(session)
    renderLogin()

    await fillAndSubmit()

    await screen.findByText('Dashboard home')
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })

  it('shows the server message when the credentials are wrong', async () => {
    vi.mocked(authApi.login).mockRejectedValue(apiError(401, 'Invalid email or password'))
    renderLogin()

    await fillAndSubmit()

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('offers to resend the verification email when the account is unverified', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      apiError(403, 'Please verify your email before logging in'),
    )
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderLogin()

    await fillAndSubmit()
    await userEvent.click(await screen.findByRole('button', { name: 'Resend verification email' }))

    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })

  it('links to registration and password reset', () => {
    renderLogin()

    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register')
  })
})
```

Run: `npx vitest run src/features/auth/pages/LoginPage.test.tsx` → FAIL (module missing).

- [ ] **Step 2: Implement the shared auth building blocks**

`frontend/src/features/auth/schemas.ts`:

```ts
import { z } from 'zod'

const email = z.string().trim().pipe(z.email('Enter a valid email address'))
const newPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')

export const loginFormSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})

export const registerFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80, 'Use at most 80 characters'),
  email,
  password: newPassword,
  currency: z.string().length(3, 'Choose a currency'),
})

export const forgotFormSchema = z.object({ email })

export const resendFormSchema = z.object({ email })

export const resetFormSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  })

export type LoginForm = z.infer<typeof loginFormSchema>
export type RegisterForm = z.infer<typeof registerFormSchema>
export type ForgotForm = z.infer<typeof forgotFormSchema>
export type ResendForm = z.infer<typeof resendFormSchema>
export type ResetForm = z.infer<typeof resetFormSchema>
```

`frontend/src/features/auth/currencies.ts`:

```ts
export interface CurrencyOption {
  code: string
  label: string
}

const names = new Intl.DisplayNames(['en'], { type: 'currency' })

export const CURRENCY_OPTIONS: CurrencyOption[] = Intl.supportedValuesOf('currency').map((code) => ({
  code,
  label: `${code} – ${names.of(code) ?? code}`,
}))
```

`frontend/src/features/auth/components/AuthLayout.tsx`:

```tsx
import type { ReactNode } from 'react'
import '../auth.css'

interface AuthLayoutProps {
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <main className="auth">
      <div className="auth__card card">
        <h1>{title}</h1>
        {children}
        {footer && <p className="auth__footer muted">{footer}</p>}
      </div>
    </main>
  )
}
```

`frontend/src/features/auth/auth.css`:

```css
.auth {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}
.auth__card {
  width: min(420px, 100%);
}
.auth__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: var(--space-4) 0 0;
}
.auth .form-error {
  margin: 0 0 var(--space-3);
  color: var(--danger);
}
.auth form .btn {
  width: 100%;
  justify-content: center;
}
.auth .btn + .btn,
.auth p + .btn {
  margin-top: var(--space-2);
}
```

- [ ] **Step 3: Implement LoginPage**

`frontend/src/features/auth/pages/LoginPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import { useLogin, useResendVerification } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { loginFormSchema, type LoginForm } from '../schemas'

/** Where to go after login: the page the user was sent away from, if it is a local path. */
function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = state.from
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  }
  return '/'
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginFormSchema) })

  const unverified = axios.isAxiosError(login.error) && login.error.response?.status === 403

  function onSubmit(values: LoginForm) {
    login.mutate(values, {
      onSuccess: () => navigate(redirectTarget(location.state), { replace: true }),
    })
  }

  function onResend() {
    resend.mutate(
      { email: getValues('email') },
      { onSuccess: () => pushToast('If that account needs verifying, a new link is on its way.', 'success') },
    )
  }

  return (
    <AuthLayout
      title="Log in"
      footer={
        <>
          <Link to="/forgot-password">Forgot your password?</Link>
          <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message}>
          <input type="password" autoComplete="current-password" {...register('password')} />
        </FormField>
        {login.isError && <p className="form-error">{getErrorMessage(login.error)}</p>}
        <Button type="submit" variant="primary" loading={login.isPending}>
          Log in
        </Button>
        {unverified && (
          <Button onClick={onResend} loading={resend.isPending}>
            Resend verification email
          </Button>
        )}
      </form>
    </AuthLayout>
  )
}
```

Run the LoginPage test → PASS (6 tests).

- [ ] **Step 4: Write the failing RegisterPage test**

`frontend/src/features/auth/pages/RegisterPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import RegisterPage from './RegisterPage'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
})

async function fillForm(password = 'a-long-passphrase') {
  await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace')
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), password)
}

describe('RegisterPage', () => {
  it('validates the form before calling the API', async () => {
    renderWithProviders(<RegisterPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Enter your name')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('defaults the currency to USD and offers the other currencies', () => {
    renderWithProviders(<RegisterPage />)

    expect(screen.getByLabelText(/currency/i)).toHaveValue('USD')
    expect(screen.getByRole('option', { name: /JPY/ })).toBeInTheDocument()
  })

  it('registers and then asks the user to check their inbox', async () => {
    vi.mocked(authApi.register).mockResolvedValue()
    renderWithProviders(<RegisterPage />)

    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText(/currency/i), 'EUR')
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument()
    expect(vi.mocked(authApi.register).mock.calls[0]?.[0]).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'a-long-passphrase',
      currency: 'EUR',
    })
  })

  it('shows the server message when registration is rejected', async () => {
    vi.mocked(authApi.register).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 400,
        statusText: '',
        data: { message: 'Validation failed' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderWithProviders(<RegisterPage />)

    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Validation failed')).toBeInTheDocument()
  })

  it('can resend the verification email from the confirmation screen', async () => {
    vi.mocked(authApi.register).mockResolvedValue()
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderWithProviders(<RegisterPage />)
    await fillForm()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Resend the email' }))

    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })
})
```

Run → FAIL (module missing).

- [ ] **Step 5: Implement RegisterPage**

`frontend/src/features/auth/pages/RegisterPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { pushToast } from '@/shared/ui/toast'
import { useRegister, useResendVerification } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { CURRENCY_OPTIONS } from '../currencies'
import { registerFormSchema, type RegisterForm } from '../schemas'

export default function RegisterPage() {
  const registerUser = useRegister()
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { currency: 'USD' },
  })

  if (registerUser.isSuccess) {
    const email = getValues('email').trim()
    return (
      <AuthLayout title="Check your inbox" footer={<Link to="/login">Back to log in</Link>}>
        <p>
          We sent a verification link to <strong>{email}</strong>. It expires in 24 hours, so open it
          soon.
        </p>
        <Button
          loading={resend.isPending}
          onClick={() =>
            resend.mutate(
              { email },
              { onSuccess: () => pushToast('If that account needs verifying, a new link is on its way.', 'success') },
            )
          }
        >
          Resend the email
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create your account" footer={<Link to="/login">I already have an account</Link>}>
      <form onSubmit={handleSubmit((values) => registerUser.mutate(values))} noValidate>
        <FormField label="Name" error={errors.name?.message}>
          <input autoComplete="name" {...register('name')} />
        </FormField>
        <FormField label="Email" error={errors.email?.message}>
          <input type="email" autoComplete="email" {...register('email')} />
        </FormField>
        <FormField label="Password" error={errors.password?.message} hint="At least 10 characters">
          <input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField
          label="Currency"
          error={errors.currency?.message}
          hint="Used for all your amounts. It cannot be changed once you have data."
        >
          <select {...register('currency')}>
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        {registerUser.isError && <p className="form-error">{getErrorMessage(registerUser.error)}</p>}
        <Button type="submit" variant="primary" loading={registerUser.isPending}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
```

Run: `npx vitest run src/features/auth/pages` → PASS.

- [ ] **Step 6: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(auth): add login and registration pages" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Email verification, forgot-password and reset-password pages

**Files:**
- Create: `frontend/src/features/auth/useUrlToken.ts`, `components/ResendVerificationForm.tsx`, `pages/VerifyEmailPage.tsx`, `pages/VerifyEmailPage.test.tsx`, `pages/ForgotPasswordPage.tsx`, `pages/ForgotPasswordPage.test.tsx`, `pages/ResetPasswordPage.tsx`, `pages/ResetPasswordPage.test.tsx`

**Interfaces:**
- Produces: `useUrlToken(): string | null` (returns the `?token=` value captured on first render and removes it from the address bar, once, even under React StrictMode); `ResendVerificationForm()`; default-exported `VerifyEmailPage`, `ForgotPasswordPage`, `ResetPasswordPage`.

- [ ] **Step 1: Write the failing verify-page tests**

`frontend/src/features/auth/pages/VerifyEmailPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { StrictMode } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import VerifyEmailPage from './VerifyEmailPage'

vi.mock('../api/authApi')

function LocationProbe() {
  return <output aria-label="search">{useLocation().search}</output>
}

function renderVerify(route: string) {
  return renderWithProviders(
    <StrictMode>
      <Routes>
        <Route
          path="/verify-email"
          element={
            <>
              <VerifyEmailPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </StrictMode>,
    { route },
  )
}

const TOKEN = 'a'.repeat(64)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('VerifyEmailPage', () => {
  it('verifies the token once, even under StrictMode, and removes it from the address bar', async () => {
    vi.mocked(authApi.verifyEmail).mockResolvedValue()

    renderVerify(`/verify-email?token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument()
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(authApi.verifyEmail).mock.calls[0]?.[0]).toEqual({ token: TOKEN })
    expect(screen.getByLabelText('search').textContent).toBe('')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('explains an invalid or expired link and offers a new one', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 400,
        statusText: '',
        data: { message: 'Invalid or expired token' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )

    renderVerify(`/verify-email?token=${TOKEN}`)

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('search').textContent).toBe('')
  })

  it('asks the user to check their inbox when there is no token, without calling the API', () => {
    renderVerify('/verify-email')

    expect(screen.getByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument()
    expect(authApi.verifyEmail).not.toHaveBeenCalled()
  })

  it('resends a link and confirms without saying whether the account exists', async () => {
    vi.mocked(authApi.resendVerification).mockResolvedValue()
    renderVerify('/verify-email')

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))

    expect(await screen.findByText(/new link is on its way/i)).toBeInTheDocument()
    expect(vi.mocked(authApi.resendVerification).mock.calls[0]?.[0]).toEqual({
      email: 'ada@example.com',
    })
  })
})
```

Run → FAIL (modules missing).

- [ ] **Step 2: Implement the token hook, resend form and verify page**

`frontend/src/features/auth/useUrlToken.ts`:

```ts
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

/**
 * Reads `?token=` once and removes it from the address bar, so it does not linger in history,
 * screenshots or the Referer header. The ref guards against StrictMode running the effect twice.
 */
export function useUrlToken(): string | null {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [token] = useState(() => searchParams.get('token'))
  const cleaned = useRef(false)

  useEffect(() => {
    if (cleaned.current) return
    cleaned.current = true
    navigate({ search: '' }, { replace: true })
  }, [navigate])

  return token
}
```

`frontend/src/features/auth/components/ResendVerificationForm.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { useResendVerification } from '../api/hooks'
import { resendFormSchema, type ResendForm } from '../schemas'

/** Same confirmation whether or not the address has an account. */
export function ResendVerificationForm() {
  const resend = useResendVerification()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendForm>({ resolver: zodResolver(resendFormSchema) })

  if (resend.isSuccess) {
    return <p role="status">If that account needs verifying, a new link is on its way.</p>
  }

  return (
    <form onSubmit={handleSubmit((values) => resend.mutate(values))} noValidate>
      <FormField label="Email" error={errors.email?.message}>
        <input type="email" autoComplete="email" {...register('email')} />
      </FormField>
      {resend.isError && <p className="form-error">{getErrorMessage(resend.error)}</p>}
      <Button type="submit" loading={resend.isPending}>
        Send a new link
      </Button>
    </form>
  )
}
```

`frontend/src/features/auth/pages/VerifyEmailPage.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useVerifyEmail } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { ResendVerificationForm } from '../components/ResendVerificationForm'
import { useUrlToken } from '../useUrlToken'

export default function VerifyEmailPage() {
  const token = useUrlToken()
  const { mutate: verify, isSuccess, isError } = useVerifyEmail()
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    verify({ token })
  }, [token, verify])

  if (isSuccess) {
    return (
      <AuthLayout title="Email verified">
        <p>Your email is verified. You can log in now.</p>
        <Link className="btn btn--primary" to="/login">
          Log in
        </Link>
      </AuthLayout>
    )
  }

  if (token && !isError) {
    return (
      <AuthLayout title="Verifying your email">
        <LoadingState label="Verifying…" />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={isError ? 'That link did not work' : 'Check your inbox'}
      footer={<Link to="/login">Back to log in</Link>}
    >
      <p role={isError ? 'alert' : undefined}>
        {isError
          ? 'This link is invalid or has expired. Enter your email to get a new one.'
          : 'Open the link in the email we sent you to verify your address. Did not get it? We can send another.'}
      </p>
      <ResendVerificationForm />
    </AuthLayout>
  )
}
```

Run: `npx vitest run src/features/auth/pages/VerifyEmailPage.test.tsx` → PASS (4 tests).

- [ ] **Step 3: Write the failing forgot-password tests**

`frontend/src/features/auth/pages/ForgotPasswordPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import ForgotPasswordPage from './ForgotPasswordPage'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ForgotPasswordPage', () => {
  it('validates the email first', async () => {
    renderWithProviders(<ForgotPasswordPage />)

    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(authApi.forgotPassword).not.toHaveBeenCalled()
  })

  it('shows the same confirmation without saying whether the account exists', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue()
    renderWithProviders(<ForgotPasswordPage />)

    await userEvent.type(screen.getByLabelText('Email'), 'anyone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(
      await screen.findByText('If an account exists for that email, a reset link is on its way.'),
    ).toBeInTheDocument()
    expect(vi.mocked(authApi.forgotPassword).mock.calls[0]?.[0]).toEqual({
      email: 'anyone@example.com',
    })
  })
})
```

Implement `frontend/src/features/auth/pages/ForgotPasswordPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { useForgotPassword } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { forgotFormSchema, type ForgotForm } from '../schemas'

export default function ForgotPasswordPage() {
  const forgot = useForgotPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotForm>({ resolver: zodResolver(forgotFormSchema) })

  return (
    <AuthLayout title="Forgot your password?" footer={<Link to="/login">Back to log in</Link>}>
      {forgot.isSuccess ? (
        <p role="status">If an account exists for that email, a reset link is on its way.</p>
      ) : (
        <form onSubmit={handleSubmit((values) => forgot.mutate(values))} noValidate>
          <FormField label="Email" error={errors.email?.message}>
            <input type="email" autoComplete="email" {...register('email')} />
          </FormField>
          {forgot.isError && <p className="form-error">{getErrorMessage(forgot.error)}</p>}
          <Button type="submit" variant="primary" loading={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
```

Run: `npx vitest run src/features/auth/pages/ForgotPasswordPage.test.tsx` → PASS.

- [ ] **Step 4: Write the failing reset-password tests**

`frontend/src/features/auth/pages/ResetPasswordPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import ResetPasswordPage from './ResetPasswordPage'

vi.mock('../api/authApi')

const TOKEN = 'b'.repeat(64)

function LocationProbe() {
  return <output aria-label="search">{useLocation().search}</output>
}

function renderReset(route: string) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/reset-password"
        element={
          <>
            <ResetPasswordPage />
            <LocationProbe />
          </>
        }
      />
    </Routes>,
    { route },
  )
}

async function fill(password: string, confirm: string) {
  await userEvent.type(screen.getByLabelText('New password'), password)
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ResetPasswordPage', () => {
  it('points to the forgot-password page when the link has no token', () => {
    renderReset('/reset-password')

    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it('removes the token from the address bar', () => {
    renderReset(`/reset-password?token=${TOKEN}`)

    expect(screen.getByLabelText('search').textContent).toBe('')
  })

  it('rejects mismatched passwords without calling the API', async () => {
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-different-one')

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(authApi.resetPassword).not.toHaveBeenCalled()
  })

  it('changes the password with the captured token and links to log in', async () => {
    vi.mocked(authApi.resetPassword).mockResolvedValue()
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-long-passphrase')

    expect(await screen.findByText(/password has been changed/i)).toBeInTheDocument()
    expect(vi.mocked(authApi.resetPassword).mock.calls[0]?.[0]).toEqual({
      token: TOKEN,
      password: 'a-long-passphrase',
    })
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('explains an expired link and offers a new one', async () => {
    vi.mocked(authApi.resetPassword).mockRejectedValue(
      new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
        status: 400,
        statusText: '',
        data: { message: 'Invalid or expired token' },
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }),
    )
    renderReset(`/reset-password?token=${TOKEN}`)

    await fill('a-long-passphrase', 'a-long-passphrase')

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument()
  })
})
```

Implement `frontend/src/features/auth/pages/ResetPasswordPage.tsx`:

```tsx
import { zodResolver } from '@hookform/resolvers/zod'
import axios from 'axios'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { getErrorMessage } from '@/shared/api/httpClient'
import { Button } from '@/shared/ui/Button'
import { FormField } from '@/shared/ui/FormField'
import { useResetPassword } from '../api/hooks'
import { AuthLayout } from '../components/AuthLayout'
import { resetFormSchema, type ResetForm } from '../schemas'
import { useUrlToken } from '../useUrlToken'

export default function ResetPasswordPage() {
  const token = useUrlToken()
  const reset = useResetPassword()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetForm>({ resolver: zodResolver(resetFormSchema) })

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Password changed">
        <p>Your password has been changed. You can log in now.</p>
        <Link className="btn btn--primary" to="/login">
          Log in
        </Link>
      </AuthLayout>
    )
  }

  const linkExpired = axios.isAxiosError(reset.error) && reset.error.response?.status === 400

  if (!token || linkExpired) {
    return (
      <AuthLayout title="Reset your password">
        <p role="alert">This link is invalid or has expired.</p>
        <Link className="btn" to="/forgot-password">
          Request a new link
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={handleSubmit(({ password }) => reset.mutate({ token, password }))} noValidate>
        <FormField label="New password" error={errors.password?.message} hint="At least 10 characters">
          <input type="password" autoComplete="new-password" {...register('password')} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm?.message}>
          <input type="password" autoComplete="new-password" {...register('confirm')} />
        </FormField>
        {reset.isError && <p className="form-error">{getErrorMessage(reset.error)}</p>}
        <Button type="submit" variant="primary" loading={reset.isPending}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  )
}
```

Run: `npx vitest run src/features/auth/pages` → PASS.

- [ ] **Step 5: Run all checks and commit**

```bash
npm run lint && npm run typecheck && npm test
git add frontend
git commit -m "feat(auth): add email verification, forgot-password and reset-password pages" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Route guards, session gate, user menu and wiring

**Files:**
- Create: `frontend/src/features/auth/components/ProtectedRoute.tsx`, `components/GuestRoute.tsx`, `components/SessionGate.tsx`, `components/UserMenu.tsx`, `components/guards.test.tsx`, `components/UserMenu.test.tsx`, `routes.ts`, `index.ts`
- Modify: `frontend/src/app/router.ts`, `frontend/src/app/App.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/main.tsx`

**Interfaces:**
- Produces (from `@/features/auth`): `authRoutes: RouteObject[]`, `ProtectedRoute`, `SessionGate({ children })`, `UserMenu`, `initAuth`, `useSessionUser`, `updateSessionUser`, `useChangePassword`, `useUpdateProfile`.

- [ ] **Step 1: Write the failing guard and menu tests**

`frontend/src/features/auth/components/guards.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { useAuthStore } from '../store/authStore'
import { GuestRoute } from './GuestRoute'
import { ProtectedRoute } from './ProtectedRoute'

function LoginProbe() {
  const location = useLocation()
  return <p>Login page (from {String((location.state as { from?: string } | null)?.from)})</p>
}

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/board" element={<p>Board</p>} />
      </Route>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginProbe />} />
      </Route>
      <Route path="/" element={<p>Home</p>} />
    </Routes>,
    { route },
  )
}

const user = { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' }

beforeEach(() => {
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null })
})

describe('ProtectedRoute', () => {
  it('waits while the session is being restored', () => {
    renderApp('/board')

    expect(screen.getByRole('status')).toHaveTextContent('Loading your account')
    expect(screen.queryByText('Board')).not.toBeInTheDocument()
  })

  it('sends anonymous visitors to log in and remembers where they were going', () => {
    useAuthStore.setState({ status: 'anonymous' })

    renderApp('/board')

    expect(screen.getByText('Login page (from /board)')).toBeInTheDocument()
  })

  it('shows the page to a signed-in user', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/board')

    expect(screen.getByText('Board')).toBeInTheDocument()
  })
})

describe('GuestRoute', () => {
  it('sends a signed-in user away from the login page', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user })

    renderApp('/login')

    expect(screen.getByText('Home')).toBeInTheDocument()
  })

  it('waits while the session is unknown, then shows the login page to anonymous visitors', () => {
    const { unmount } = renderApp('/login')
    expect(screen.getByRole('status')).toBeInTheDocument()
    unmount()

    useAuthStore.setState({ status: 'anonymous' })
    renderApp('/login')
    expect(screen.getByText(/Login page/)).toBeInTheDocument()
  })
})
```

`frontend/src/features/auth/components/UserMenu.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import { renderWithProviders } from '@/test/render'
import * as authApi from '../api/authApi'
import { useAuthStore } from '../store/authStore'
import { UserMenu } from './UserMenu'

vi.mock('../api/authApi')

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
})

describe('UserMenu', () => {
  it('renders nothing when nobody is signed in', () => {
    useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null })

    const { container } = renderWithProviders(<UserMenu />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the name and logs out, clearing the session and every cached query', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'token',
      user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
    })
    queryClient.setQueryData(['tasks'], ['ada only'])
    vi.mocked(authApi.logout).mockResolvedValue()
    renderWithProviders(<UserMenu />)

    expect(screen.getByText('Ada')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
    expect(authApi.logout).toHaveBeenCalledTimes(1)
  })
})
```

Run: `npx vitest run src/features/auth/components` → FAIL (modules missing).

- [ ] **Step 2: Implement the components**

`frontend/src/features/auth/components/ProtectedRoute.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useAuthStore } from '../store/authStore'

export function ProtectedRoute() {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  if (status === 'unknown') return <LoadingState label="Loading your account…" />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
```

`frontend/src/features/auth/components/GuestRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useAuthStore } from '../store/authStore'

/** For pages only signed-out visitors need: login, register, forgot password. */
export function GuestRoute() {
  const status = useAuthStore((state) => state.status)

  if (status === 'unknown') return <LoadingState label="Loading your account…" />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
```

`frontend/src/features/auth/components/SessionGate.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'
import { bootstrapSession } from '../session'

/** Restores the session from the refresh cookie once, when the app starts. */
export function SessionGate({ children }: { children: ReactNode }) {
  useEffect(() => {
    void bootstrapSession()
  }, [])

  return <>{children}</>
}
```

`frontend/src/features/auth/components/UserMenu.tsx`:

```tsx
import { Button } from '@/shared/ui/Button'
import { useLogout, useSessionUser } from '../api/hooks'

export function UserMenu() {
  const user = useSessionUser()
  const { mutate: logout, isPending } = useLogout()

  if (!user) return null

  return (
    <div className="user-menu">
      <span className="muted">{user.name}</span>
      <Button variant="ghost" loading={isPending} onClick={() => logout()}>
        Log out
      </Button>
    </div>
  )
}
```

Append to `frontend/src/features/auth/auth.css`:

```css
.user-menu {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
```

and add `import './auth.css'` at the top of `UserMenu.tsx`.

Run: `npx vitest run src/features/auth/components` → PASS.

- [ ] **Step 3: Add the routes and the public API**

`frontend/src/features/auth/routes.ts`:

```ts
import type { RouteObject } from 'react-router'
import { GuestRoute } from './components/GuestRoute'

export const authRoutes: RouteObject[] = [
  {
    Component: GuestRoute,
    children: [
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('./pages/LoginPage')).default }),
      },
      {
        path: 'register',
        lazy: async () => ({ Component: (await import('./pages/RegisterPage')).default }),
      },
      {
        path: 'forgot-password',
        lazy: async () => ({ Component: (await import('./pages/ForgotPasswordPage')).default }),
      },
    ],
  },
  {
    path: 'verify-email',
    lazy: async () => ({ Component: (await import('./pages/VerifyEmailPage')).default }),
  },
  {
    path: 'reset-password',
    lazy: async () => ({ Component: (await import('./pages/ResetPasswordPage')).default }),
  },
]
```

`frontend/src/features/auth/index.ts`:

```ts
export { useChangePassword, useSessionUser, useUpdateProfile } from './api/hooks'
export { ProtectedRoute } from './components/ProtectedRoute'
export { SessionGate } from './components/SessionGate'
export { UserMenu } from './components/UserMenu'
export { authRoutes } from './routes'
export { initAuth, updateSessionUser } from './session'
```

- [ ] **Step 4: Wire it into the app**

`frontend/src/app/router.ts`:

```ts
import { createBrowserRouter } from 'react-router'
import { authRoutes, ProtectedRoute } from '@/features/auth'
import { dashboardRoutes } from '@/features/dashboard'
import { NotFoundPage } from '@/shared/ui/NotFoundPage'
import { AppShell } from './AppShell'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      ...authRoutes,
      {
        Component: ProtectedRoute,
        children: [{ Component: AppShell, children: [...dashboardRoutes] }],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
```

`frontend/src/app/App.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider } from 'react-router'
import { SessionGate } from '@/features/auth'
import { queryClient } from '@/shared/lib/queryClient'
import { router } from './router'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

In `frontend/src/app/AppShell.tsx` add `import { UserMenu } from '@/features/auth'` and render `<UserMenu />` after `<ThemeToggle />` inside `shell__actions`.

In `frontend/src/main.tsx` add `import { initAuth } from '@/features/auth'` and call `initAuth()` on the line after `initTheme()`.

- [ ] **Step 5: Run all checks**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all pass. `npm run build` proves the lazy routes and the alias imports bundle.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(auth): add route guards, session restore on load and user menu" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end check in a real browser and milestone wrap-up

**Files:**
- Modify: none unless the check finds a bug (fix in a new commit with its own test)

- [ ] **Step 1: Start the dependencies**

You need a MongoDB at `MONGODB_URI` and an SMTP catcher on port 1025.

```bash
docker run -d --name tracker-mongo -p 27017:27017 mongo:8
brew install mailpit && mailpit   # UI at http://localhost:8025, SMTP on 1025
```

(Use any local MongoDB or a free Atlas cluster instead of Docker if you prefer.) Then:

```bash
cd backend && cp .env.example .env
```

In `backend/.env` set `JWT_SECRET` and `CRON_SECRET` to fresh values from `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, and `TRUST_PROXY_HOPS=0`. Start both apps in two terminals: `cd backend && npm run dev` and `cd frontend && npm run dev`.

- [ ] **Step 2: Walk the flows and check each result**

Open `http://localhost:5173`.

| Do this | Expect |
|---|---|
| Visit `/` while signed out | Redirected to `/login` |
| Register with a weak password `password1234` | Inline error from the server, no account |
| Register properly | "Check your inbox" screen; a verification email in Mailpit |
| Try to log in before verifying | Message asking you to verify, with a resend button |
| Click the link in the email | The address bar loses `?token=...` at once; "Email verified" |
| Reuse the same link | "That link did not work" |
| Log in | Dashboard, your name and Log out in the top bar |
| Reload the page (F5) | Still signed in (session restored from the cookie) |
| DevTools, Application tab | Cookie `refresh_token` is HttpOnly with path `/api/auth`; `localStorage` has only `theme`; no token anywhere |
| Open a second tab | Signed in there too; no forced logout |
| Log out | Redirected to `/login`; reload keeps you logged out |
| Forgot password, follow the emailed link, set a new one | Old password fails, new password works, and the other tab is signed out on its next request |

- [ ] **Step 3: Run the complete checks and finish the branch**

```bash
(cd backend && npm run lint && npm run typecheck && npm test && npm run build)
(cd frontend && npm run lint && npm run typecheck && npm test && npm run build)
git status
```

Expected: everything passes and the tree is clean (`.env` is ignored). Then REQUIRED SUB-SKILL: use superpowers:finishing-a-development-branch to merge `feature/auth-accounts` into `main`.
