import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { logoutUser, refreshSession, startSession, updateSessionUser } from './session'
import { useAuthStore } from './store/authStore'

vi.mock('./api/authApi')

const session = {
  accessToken: 'token-1',
  user: { id: '1', email: 'ada@example.com', name: 'Ada', currency: 'USD' },
}

function httpError(status: number) {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  queryClient.clear()
  useAuthStore.setState({ status: 'unknown', accessToken: null, user: null })
})

describe('refreshSession', () => {
  it('stores the new session', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    expect(await refreshSession()).toBe(true)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'token-1',
      user: session.user,
    })
  })

  it('shares one request between concurrent callers', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()])

    expect(results).toEqual([true, true, true])
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('makes a new request once the previous one has finished', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await refreshSession()
    await refreshSession()

    expect(authApi.refresh).toHaveBeenCalledTimes(2)
  })

  it('ends the session and clears every cached query when the server says 401', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(401))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      accessToken: null,
      user: null,
    })
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })

  it('keeps an existing session when the failure is only the network or a gateway', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['still mine'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(504))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(queryClient.getQueryData(['tasks'])).toEqual(['still mine'])
  })

  it('falls back to anonymous at start-up when the server cannot be reached', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('Network Error'))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})

describe('a refresh that finishes after the session changed', () => {
  function deferredRefresh() {
    let resolve: (value: typeof session) => void = () => undefined
    let reject: (reason: unknown) => void = () => undefined
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((res, rej) => {
        resolve = res
        reject = rej
      }),
    )
    return { resolve, reject }
  }

  it('does not bring back a session the user has since logged out of', async () => {
    startSession({ ...session, accessToken: 'old' })
    const late = deferredRefresh()
    vi.mocked(authApi.logout).mockResolvedValue()
    const pending = refreshSession()

    await logoutUser()
    late.resolve(session)

    expect(await pending).toBe(false)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      accessToken: null,
      user: null,
    })
  })

  it('does not wipe the session or cache a newer login has since established', async () => {
    startSession({ ...session, accessToken: 'old' })
    const late = deferredRefresh()
    const pending = refreshSession()

    startSession({ ...session, accessToken: 'new' })
    queryClient.setQueryData(['tasks'], ['new login data'])
    late.reject(httpError(401))

    expect(await pending).toBe(true)
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: 'new' })
    expect(queryClient.getQueryData(['tasks'])).toEqual(['new login data'])
  })
})

describe('logoutUser', () => {
  it('clears the session and the query cache even when the request fails', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.logout).mockRejectedValue(new Error('Network Error'))

    await logoutUser()

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })
})

describe('updateSessionUser', () => {
  it('merges changes into the signed-in user', () => {
    useAuthStore.getState().setSession(session)

    updateSessionUser({ name: 'Ada L.' })

    expect(useAuthStore.getState().user).toEqual({ ...session.user, name: 'Ada L.' })
  })

  it('does nothing when nobody is signed in', () => {
    updateSessionUser({ name: 'Nobody' })

    expect(useAuthStore.getState().user).toBeNull()
  })
})
