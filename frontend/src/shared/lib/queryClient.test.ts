import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { queryClient } from './queryClient'

function responseError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError(
    'failed',
    'ERR_BAD_RESPONSE',
    config,
    {},
    {
      status,
      statusText: '',
      headers: {},
      config,
      data: {},
    },
  )
}

function retryFn() {
  const retry = queryClient.getDefaultOptions().queries?.retry
  if (typeof retry !== 'function') throw new Error('retry must be a function')
  return retry
}

describe('queryClient retry', () => {
  it('retries a server error once', () => {
    const retry = retryFn()
    const error = responseError(500)

    expect(retry(0, error)).toBe(true)
    expect(retry(1, error)).toBe(false)
  })

  it('retries an unknown error once', () => {
    const retry = retryFn()
    const error = new Error('boom')

    expect(retry(0, error)).toBe(true)
    expect(retry(1, error)).toBe(false)
  })

  it.each([502, 503, 504])(
    'does not retry a %i (the cold-start interceptor already did)',
    (status) => {
      expect(retryFn()(0, responseError(status))).toBe(false)
    },
  )

  it('does not retry when there was no response at all', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK')

    expect(retryFn()(0, error)).toBe(false)
  })
})
