import bcrypt from 'bcryptjs'
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
import { User } from './user.model.ts'

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

async function storedPasswordHash(email: string): Promise<string> {
  const stored = await User.findOne({ email }).select('+password').lean()
  return stored?.password ?? ''
}

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

  it('stores the new password as a bcrypt hash', async () => {
    const user = await registerVerified()
    await forgot(user.email)

    await reset(lastMailToken(), NEW_PASSWORD).expect(200)

    const hash = await storedPasswordHash(user.email)
    expect(hash).not.toBe(NEW_PASSWORD)
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true)
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
    const verifyToken = lastMailToken()

    await reset(verifyToken, NEW_PASSWORD).expect(400)

    expect((await User.findOne({ email: input.email }).lean())?.emailVerifiedAt).toBeUndefined()
    expect(await bcrypt.compare(input.password, await storedPasswordHash(input.email))).toBe(true)
    await request(app).post('/api/auth/verify-email').send({ token: verifyToken }).expect(200)
  })

  it('does not accept a reset token as an email-verification token', async () => {
    const user = await registerVerified()
    await forgot(user.email)
    const resetToken = lastMailToken()

    await request(app).post('/api/auth/verify-email').send({ token: resetToken }).expect(400)

    await reset(resetToken, NEW_PASSWORD).expect(200)
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
    request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)

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

    await change(body.accessToken, {
      currentPassword: VALID_PASSWORD,
      newPassword: 'short',
    }).expect(400)
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

  it('stores the new password as a bcrypt hash', async () => {
    const user = await registerVerified()
    const { body } = await login(user.email, user.password)

    await change(body.accessToken, {
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200)

    const hash = await storedPasswordHash(user.email)
    expect(hash).not.toBe(NEW_PASSWORD)
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
    expect(await bcrypt.compare(NEW_PASSWORD, hash)).toBe(true)
  })
})
