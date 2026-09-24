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
