import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAuth, getErrorMessage, httpClient } from './httpClient'

const originalAdapter = httpClient.defaults.adapter

const bearer = (config: InternalAxiosRequestConfig) =>
  String(config.headers.get('Authorization') ?? '')

/** Points the shared client at a fake server. Returns the Authorization header of each call. */
function useServer(statusFor: (config: InternalAxiosRequestConfig) => number): string[] {
  const calls: string[] = []
  const adapter: AxiosAdapter = async (config) => {
    calls.push(bearer(config))
    const status = statusFor(config)
    const response = { data: {}, status, statusText: '', headers: {}, config }
    if (status >= 400) throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, response)
    return response
  }
  httpClient.defaults.adapter = adapter
  return calls
}

afterEach(() => {
  httpClient.defaults.adapter = originalAdapter
  configureAuth({ getToken: () => null, onUnauthorized: async () => false })
})

describe('httpClient auth handling', () => {
  it('sends the bearer token when there is one', async () => {
    const calls = useServer(() => 200)
    configureAuth({ getToken: () => 'abc', onUnauthorized: async () => false })

    await httpClient.get('/things')

    expect(calls).toEqual(['Bearer abc'])
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    let token = 'old'
    const calls = useServer((config) => (bearer(config) === 'Bearer old' ? 401 : 200))
    const refresh = vi.fn(async () => {
      token = 'new'
      return true
    })
    configureAuth({ getToken: () => token, onUnauthorized: refresh })

    const response = await httpClient.get('/things')

    expect(response.status).toBe(200)
    expect(calls).toEqual(['Bearer old', 'Bearer new'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not loop when the retry is also unauthorized', async () => {
    const calls = useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => 'tok', onUnauthorized: refresh })

    await expect(httpClient.get('/things')).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls).toHaveLength(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('rejects with the original error when the refresh fails', async () => {
    const calls = useServer(() => 401)
    configureAuth({ getToken: () => 'tok', onUnauthorized: async () => false })

    await expect(httpClient.get('/things')).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls).toHaveLength(1)
  })

  it('never tries to refresh a request marked skipAuthRefresh', async () => {
    useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => 'tok', onUnauthorized: refresh })

    await expect(
      httpClient.post('/auth/refresh', undefined, { skipAuthRefresh: true }),
    ).rejects.toThrow()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refresh anonymous requests such as a wrong-password login', async () => {
    useServer(() => 401)
    const refresh = vi.fn(async () => true)
    configureAuth({ getToken: () => null, onUnauthorized: refresh })

    await expect(httpClient.post('/auth/login', {})).rejects.toThrow()

    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('getErrorMessage', () => {
  it('prefers the API message, then the error message, then a generic one', () => {
    const apiError = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
      status: 409,
      statusText: '',
      data: { message: 'Already exists' },
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    })

    expect(getErrorMessage(apiError)).toBe('Already exists')
    expect(getErrorMessage(new Error('Network Error'))).toBe('Network Error')
    expect(getErrorMessage('nonsense')).toBe('Something went wrong')
  })

  it('says the server is waking up for a gateway error or no response at all', () => {
    const gateway = new AxiosError(
      'Request failed with status code 504',
      'ERR_BAD_RESPONSE',
      undefined,
      null,
      {
        status: 504,
        statusText: '',
        data: {},
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      },
    )
    const noResponse = new AxiosError('Network Error', 'ERR_NETWORK')

    expect(getErrorMessage(gateway)).toBe('The server is waking up. Please try again in a moment.')
    expect(getErrorMessage(noResponse)).toBe(
      'The server is waking up. Please try again in a moment.',
    )
  })
})
