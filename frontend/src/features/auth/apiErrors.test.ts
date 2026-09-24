import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { applyFieldErrors, getFieldErrors, hasFieldErrorFor } from './apiErrors'

function apiError(status: number, data: unknown) {
  return new AxiosError('bad', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

const validation = apiError(400, {
  message: 'Validation failed',
  errors: [
    { path: 'password', message: 'That password is too common' },
    { path: 'other', message: 'Ignored' },
  ],
})

describe('getFieldErrors', () => {
  it('reads the errors array of a 400 response', () => {
    expect(getFieldErrors(validation)).toHaveLength(2)
  })

  it('returns nothing for other statuses, malformed bodies and non-API errors', () => {
    expect(getFieldErrors(apiError(409, { errors: [{ path: 'a', message: 'b' }] }))).toEqual([])
    expect(getFieldErrors(apiError(400, { errors: 'nope' }))).toEqual([])
    expect(getFieldErrors(apiError(400, { errors: [{ path: 1 }, null] }))).toEqual([])
    expect(getFieldErrors(new Error('x'))).toEqual([])
  })
})

describe('hasFieldErrorFor', () => {
  it('is true only when a listed field is explained', () => {
    expect(hasFieldErrorFor(validation, ['password'])).toBe(true)
    expect(hasFieldErrorFor(validation, ['email'])).toBe(false)
  })
})

describe('applyFieldErrors', () => {
  it('sets an error only on the fields the form has', () => {
    const setError = vi.fn()

    applyFieldErrors(validation, setError, ['email', 'password'])

    expect(setError).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('password', {
      type: 'server',
      message: 'That password is too common',
    })
  })
})
