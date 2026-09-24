import { Types } from 'mongoose'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { request } from '../../test/http.ts'
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
    await request(app)
      .post('/api/auth/login')
      .send({ email: input.email, password: input.password })
    expect(await RefreshToken.countDocuments()).toBe(1)

    await deleteUser(id)

    expect(await User.countDocuments()).toBe(0)
    expect(await RefreshToken.countDocuments()).toBe(0)
    expect(await EmailToken.countDocuments()).toBe(0)
  })
})
