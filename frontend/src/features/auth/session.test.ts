import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useServerStatus } from '@/shared/api/serverStatus'
import { warmUpServer } from '@/shared/api/warmUp'
import {
  bootstrapSession,
  logoutUser,
  refreshSession,
  retryBootstrap,
  startSession,
  updateSessionUser,
} from './session'
import { useAuthStore } from './store/authStore'

vi.mock('./api/authApi')
vi.mock('@/shared/api/warmUp')

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

  it('does not treat an unreachable server as a logged-out user at start-up', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('Network Error'))

    expect(await refreshSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('unknown')
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

describe('bootstrapSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(warmUpServer).mockResolvedValue()
    useServerStatus.setState({ waking: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs once however many times it is called', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await Promise.all([bootstrapSession(), bootstrapSession()])

    expect(authApi.refresh).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('goes to anonymous straight away when the cookie is rejected', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(401))

    await retryBootstrap()

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting while the server wakes up instead of sending a returning user to login', async () => {
    vi.mocked(authApi.refresh)
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValue(session)

    const done = retryBootstrap()
    await vi.advanceTimersByTimeAsync(0)
    expect(useAuthStore.getState().status).toBe('unknown')
    expect(useServerStatus.getState().waking).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)
    await done

    expect(authApi.refresh).toHaveBeenCalledTimes(3)
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'token-1',
    })
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('gives up after a bounded number of attempts and reports the server as unavailable', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(502))

    const done = retryBootstrap()
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    expect(authApi.refresh).toHaveBeenCalledTimes(4)
    expect(useAuthStore.getState().status).toBe('unavailable')
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('tries again from scratch when asked, after the server was unavailable', async () => {
    useAuthStore.setState({ status: 'unavailable' })
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await retryBootstrap()

    expect(useAuthStore.getState().status).toBe('authenticated')
  })
})
