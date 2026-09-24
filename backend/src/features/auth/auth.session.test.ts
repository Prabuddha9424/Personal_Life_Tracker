import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { verifyAccessToken } from '../../shared/auth/token.ts'
import { env } from '../../shared/config/env.ts'
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

const DAY_MS = 86_400_000
const REFRESH_TOKEN_TTL_DAYS = env.REFRESH_TOKEN_TTL_DAYS

/** The Expires attribute of a Set-Cookie header, in epoch milliseconds. */
const cookieExpiry = (setCookie: string): number => {
  const match = /Expires=([^;]+)/i.exec(setCookie)
  return match?.[1] ? new Date(match[1]).getTime() : Number.NaN
}

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
    const unknownEmail = await login({
      email: 'nobody@example.com',
      password: 'wrong-password-123',
    })

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
    expect(setCookie).not.toContain('Secure')
    expect(cookieExpiry(setCookie)).toBeGreaterThan(
      Date.now() + (REFRESH_TOKEN_TTL_DAYS * DAY_MS - 60_000),
    )
    expect(cookieExpiry(setCookie)).toBeLessThan(
      Date.now() + (REFRESH_TOKEN_TTL_DAYS * DAY_MS + 60_000),
    )
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

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(user.email)
  })

  it('answers 401 for a valid access token whose user has been deleted', async () => {
    const user = await registerVerified()
    const { body } = await login(user)
    await User.deleteMany({})

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ message: 'Not authorized' })
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
    const setCookie = setCookies(res).find((c) => c.startsWith('refresh_token=')) ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Path=/api/auth')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toContain('Secure')
    expect(cookieExpiry(setCookie)).toBeGreaterThan(
      Date.now() + (REFRESH_TOKEN_TTL_DAYS * DAY_MS - 60_000),
    )
    expect(JSON.stringify(res.body)).not.toContain(rawValue(refreshCookie(res)))
  })

  it('slides the expiry of the stored token forward on rotation', async () => {
    const user = await registerVerified()
    const cookieA = refreshCookie(await login(user))
    await RefreshToken.updateOne(
      { tokenHash: hashToken(rawValue(cookieA)) },
      { expiresAt: new Date(Date.now() + 60_000) },
    )

    const cookieB = refreshCookie(await refreshWith(cookieA))

    const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawValue(cookieB)) }).lean()
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + (REFRESH_TOKEN_TTL_DAYS * DAY_MS - 60_000),
    )
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
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('SameSite=Lax')
    expect(cleared).not.toContain('Secure')
    expect(cookieExpiry(cleared)).toBeLessThanOrEqual(Date.now())
    await refreshWith(cookie).expect(401)
  })

  it('succeeds even when there is no cookie', async () => {
    await request(app).post('/api/auth/logout').expect(204)
  })
})
