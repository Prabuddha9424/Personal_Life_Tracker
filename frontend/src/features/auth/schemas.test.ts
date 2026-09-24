import { describe, expect, it } from 'vitest'
import { registerFormSchema, resetFormSchema } from './schemas'

const valid = {
  name: 'Ada',
  email: 'ada@example.com',
  password: 'a-long-passphrase',
  currency: 'USD',
}

describe('registerFormSchema', () => {
  it('accepts a supported currency code', () => {
    expect(registerFormSchema.safeParse({ ...valid, currency: 'JPY' }).success).toBe(true)
  })

  it.each(['', 'US', 'usd', 'ZZZ', 'XXX1'])('rejects the currency %j', (currency) => {
    const result = registerFormSchema.safeParse({ ...valid, currency })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Choose a currency')
  })

  it('trims the name and email', () => {
    const result = registerFormSchema.parse({
      ...valid,
      name: '  Ada ',
      email: ' ada@example.com ',
    })
    expect(result).toMatchObject({ name: 'Ada', email: 'ada@example.com' })
  })
})

describe('resetFormSchema', () => {
  it('requires the two passwords to match', () => {
    const result = resetFormSchema.safeParse({
      password: 'a-long-passphrase',
      confirm: 'different-one',
    })
    expect(result.error?.issues[0]).toMatchObject({
      path: ['confirm'],
      message: 'Passwords do not match',
    })
  })
})
