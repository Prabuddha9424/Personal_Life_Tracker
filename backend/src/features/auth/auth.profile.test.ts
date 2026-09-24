import { request } from '../../test/http.ts'
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

    await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '  ' })
      .expect(400)
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
