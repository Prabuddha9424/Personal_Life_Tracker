import { request } from '../../test/http.ts'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { lastMailToken, newUserInput, registerVerified, sendMailMock } from './auth.test-helpers.ts'
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
    expect(await EmailToken.countDocuments({ tokenHash: hashToken(raw), purpose: 'verify' })).toBe(
      1,
    )
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

  it('lets the latest sign-up of an unverified email win', async () => {
    const first = newUserInput({ password: 'first-password-abc', name: 'First Name' })
    await register(first)
    const oldToken = lastMailToken()

    const second = {
      ...first,
      password: 'second-password-xyz',
      name: 'Second Name',
      currency: 'EUR',
    }
    await register(second).expect(202)
    const newToken = lastMailToken()
    await verify(oldToken).expect(400)
    await verify(newToken).expect(200)

    const loginWith = (password: string) =>
      request(app).post('/api/auth/login').send({ email: first.email, password })
    await loginWith(first.password).expect(401)
    await loginWith(second.password).expect(200)
    const user = await User.findOne({ email: first.email })
    expect(user?.name).toBe('Second Name')
    expect(user?.currency).toBe('EUR')
    expect(await User.countDocuments({ email: first.email })).toBe(1)
  })

  it('answers a repeated unverified sign-up exactly like a fresh one', async () => {
    const input = newUserInput()
    const fresh = await register(newUserInput())
    await register(input)

    const repeated = await register({ ...input, password: 'another-password-123' })

    expect(repeated.status).toBe(fresh.status)
    expect(repeated.body).toEqual(fresh.body)
  })

  it('does not change a verified account when someone signs up again with its email', async () => {
    const existing = await registerVerified()
    const before = await User.findOne({ email: existing.email }).select('+password')

    await register({
      ...existing,
      password: 'attacker-password-123',
      name: 'Attacker',
      currency: 'EUR',
    }).expect(202)

    const after = await User.findOne({ email: existing.email }).select('+password')
    expect(after?.password).toBe(before?.password)
    expect(after?.name).toBe(existing.name)
    expect(after?.currency).toBe(existing.currency)
    await request(app)
      .post('/api/auth/login')
      .send({ email: existing.email, password: existing.password })
      .expect(200)
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
