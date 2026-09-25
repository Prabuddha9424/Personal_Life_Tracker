import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { describeSaveError } from './saveError'

function apiError(status: number, data: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

describe('describeSaveError', () => {
  it('uses the server message', () => {
    expect(describeSaveError(apiError(409, { message: 'Category is in use' }))).toBe(
      'Category is in use',
    )
  })

  it('appends the validation details the server lists', () => {
    const error = apiError(400, {
      message: 'Validation failed',
      errors: [
        { path: 'date', message: 'Expected a date between 2000 and 2100' },
        { path: 'amountMinor', message: 'Too big' },
      ],
    })

    expect(describeSaveError(error)).toBe(
      'Validation failed: date: Expected a date between 2000 and 2100; amountMinor: Too big',
    )
  })

  it('shows at most three details and ignores malformed entries', () => {
    const error = apiError(400, {
      message: 'Validation failed',
      errors: [
        { message: 'a' },
        null,
        { path: 5, message: 'b' },
        { message: 'c' },
        { message: 'd' },
      ],
    })

    expect(describeSaveError(error)).toBe('Validation failed: a; b; c')
  })

  it('falls back to the plain message for other errors', () => {
    expect(describeSaveError(new Error('Network Error'))).toBe('Network Error')
    expect(describeSaveError('nope')).toBe('Something went wrong')
  })
})
