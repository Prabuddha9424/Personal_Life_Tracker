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
