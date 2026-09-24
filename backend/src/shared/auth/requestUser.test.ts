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
