import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpClient } from '@/shared/api/httpClient'
import { queryClient } from '@/shared/lib/queryClient'
import * as authApi from './api/authApi'
import { useServerStatus } from '@/shared/api/serverStatus'
import { warmUpServer } from '@/shared/api/warmUp'
import {
  bootstrapSession,
  initAuth,
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

const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

/** An access token as the server issues it: only the `sub` matters to the client. */
const tokenFor = (userId: string, label = 'a') =>
  `${encode({ alg: 'HS256' })}.${encode({ sub: userId })}.${label}`

/** The Authorization header a request sent as this user carries. */
const sentBy = (userId: string, label = 'a') => `Bearer ${tokenFor(userId, label)}`

const bob = { id: '2', email: 'bob@example.com', name: 'Bob', currency: 'USD' }

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

    expect(await refreshSession(sentBy('1'))).toBe(true)

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: 'token-1',
      user: session.user,
    })
  })

  it('shares one request between concurrent callers', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    const results = await Promise.all([
      refreshSession(sentBy('1')),
      refreshSession(sentBy('1')),
      refreshSession(sentBy('1')),
    ])

    expect(results).toEqual([true, true, true])
    expect(authApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('makes a new request once the previous one has finished', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await refreshSession(sentBy('1'))
    await refreshSession(sentBy('1'))

    expect(authApi.refresh).toHaveBeenCalledTimes(2)
  })

  it('ends the session and clears every cached query when the server says 401', async () => {
    useAuthStore.getState().setSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(401))

    expect(await refreshSession(sentBy('1'))).toBe(false)

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

    expect(await refreshSession(sentBy('1'))).toBe(false)

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(queryClient.getQueryData(['tasks'])).toEqual(['still mine'])
  })

  it('does not treat an unreachable server as a logged-out user at start-up', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('Network Error'))

    expect(await refreshSession(sentBy('1'))).toBe(false)

    expect(useAuthStore.getState().status).toBe('unknown')
  })
})

describe('refreshing while another tab refreshes too', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks')
  })

  /** Two tabs share one cookie: a second refresh that overlaps the first is answered with 401. */
  function backendRejectingOverlaps() {
    let active = 0
    let calls = 0
    vi.mocked(authApi.refresh).mockImplementation(async () => {
      calls += 1
      if (active > 0) throw httpError(401)
      active += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return session
    })
    return () => calls
  }

  function installSerialisingLocks() {
    let tail: Promise<unknown> = Promise.resolve()
    const request = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      const run = tail.then(callback)
      tail = run.catch(() => undefined)
      return run
    })
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    return request
  }

  it('waits its turn behind the other tab, so its refresh uses the rotated cookie', async () => {
    const calls = backendRejectingOverlaps()
    const request = installSerialisingLocks()
    useAuthStore.setState({ status: 'unknown' })

    const otherTab = request('auth-refresh', () => authApi.refresh())
    const result = await refreshSession(sentBy('1'))
    await otherTab

    expect(result).toBe(true)
    expect(calls()).toBe(2)
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(request.mock.calls.map(([name]) => name)).toEqual(['auth-refresh', 'auth-refresh'])
  })

  it('still refreshes when the Web Locks API is not available', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    expect(await refreshSession(sentBy('1'))).toBe(true)

    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('still ends the session on an ordinary 401 when locks are available', async () => {
    installSerialisingLocks()
    startSession(session)
    queryClient.setQueryData(['tasks'], ['previous user data'])
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(401))

    expect(await refreshSession(sentBy('1'))).toBe(false)

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(queryClient.getQueryData(['tasks'])).toBeUndefined()
  })

  it('drops the answer of a refresh that waited for the lock while the session changed', async () => {
    const request = installSerialisingLocks()
    useAuthStore.setState({ status: 'unknown' })
    vi.mocked(authApi.refresh).mockResolvedValue(session)
    let release: () => void = () => undefined
    const otherTab = request(
      'auth-refresh',
      () => new Promise<void>((resolve) => (release = resolve)),
    )

    const pending = refreshSession(sentBy('1'))
    vi.mocked(authApi.logout).mockResolvedValue()
    await logoutUser()
    release()
    await otherTab

    expect(await pending).toBe(false)
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
    const pending = refreshSession(sentBy('1'))

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
    const pending = refreshSession(sentBy('1'))

    startSession({ ...session, accessToken: 'new' })
    queryClient.setQueryData(['tasks'], ['new login data'])
    late.reject(httpError(401))

    expect(await pending).toBe(true)
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', accessToken: 'new' })
    expect(queryClient.getQueryData(['tasks'])).toEqual(['new login data'])
  })
  it('does not report a renewal when a different user has logged in since', async () => {
    startSession({ ...session, accessToken: 'old' })
    const late = deferredRefresh()
    vi.mocked(authApi.logout).mockResolvedValue()
    const pending = refreshSession(sentBy('1'))

    await logoutUser()
    startSession({ accessToken: tokenFor('2'), user: bob })
    late.resolve(session)

    expect(await pending).toBe(false)
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: bob })
  })

  it('still reports a renewal when the same user has logged in again since', async () => {
    startSession({ ...session, accessToken: 'old' })
    const late = deferredRefresh()
    vi.mocked(authApi.logout).mockResolvedValue()
    const pending = refreshSession(sentBy('1'))

    await logoutUser()
    startSession({ ...session, accessToken: 'newer' })
    late.resolve(session)

    expect(await pending).toBe(true)
  })

  it('does not report a renewal when nobody was signed in and the refresh renews someone else', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: tokenFor('2'), user: bob })

    expect(await refreshSession(sentBy('1'))).toBe(false)
  })

  it.each([
    ['a token without a subject', `Bearer ${encode({})}.${encode({})}.x`],
    ['a malformed token', 'Bearer nonsense'],
    ['no token at all', ''],
  ])('never reports a renewal for %s, and does not even refresh', async (_name, sent) => {
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    expect(await refreshSession(sent)).toBe(false)

    expect(authApi.refresh).not.toHaveBeenCalled()
  })
})

describe('a request sent by one user that gets its 401 after the session changed', () => {
  const originalAdapter = httpClient.defaults.adapter
  const ada = sentBy('1', 'ada')

  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter
  })

  /** Ada's POST is held until `release()`, then answered 401; anything else is a 201. */
  function serve() {
    const calls: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const adapter: AxiosAdapter = async (config) => {
      const authorization = String(config.headers.get('Authorization') ?? '')
      calls.push(authorization)
      const isAda = authorization === ada
      if (isAda) await gate
      const status = isAda ? 401 : 201
      const response = { data: {}, status, statusText: '', headers: {}, config }
      if (status >= 400) throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, response)
      return response
    }
    httpClient.defaults.adapter = adapter
    initAuth()
    return { calls, release }
  }

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

  async function sendAsAda() {
    startSession({ accessToken: tokenFor('1', 'ada'), user: session.user })
    const outcome = httpClient
      .post('/tasks', { title: 'Ada private title' })
      .then(() => 'sent' as const)
      .catch((error: unknown) => error)
    return outcome
  }

  it('is not replayed as the next user when the 401 arrives with nobody signed in', async () => {
    const { calls, release } = serve()
    vi.mocked(authApi.logout).mockResolvedValue()
    const late = deferredRefresh()
    const outcome = sendAsAda()
    await vi.waitFor(() => expect(calls).toEqual([ada]))

    await logoutUser()
    release()
    await vi.waitFor(() => expect(authApi.refresh).toHaveBeenCalled())
    startSession({ accessToken: tokenFor('2', 'bob'), user: bob })
    late.reject(httpError(401))

    expect(await outcome).toMatchObject({ response: { status: 401 } })
    expect(calls).toEqual([ada])
  })

  it('is not replayed as the next user when they were already signed in when the 401 arrived', async () => {
    const { calls, release } = serve()
    vi.mocked(authApi.logout).mockResolvedValue()
    vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: tokenFor('2', 'bob'), user: bob })
    const outcome = sendAsAda()
    await vi.waitFor(() => expect(calls).toEqual([ada]))

    await logoutUser()
    startSession({ accessToken: tokenFor('2', 'bob'), user: bob })
    release()

    expect(await outcome).toMatchObject({ response: { status: 401 } })
    expect(calls).toEqual([ada])
  })

  it('is still retried, with the new token, when the same user signed in again', async () => {
    const { calls, release } = serve()
    vi.mocked(authApi.logout).mockResolvedValue()
    vi.mocked(authApi.refresh).mockResolvedValue({
      accessToken: tokenFor('1', 'ada-2'),
      user: session.user,
    })
    const outcome = sendAsAda()
    await vi.waitFor(() => expect(calls).toEqual([ada]))

    await logoutUser()
    startSession({ accessToken: tokenFor('1', 'ada-1b'), user: session.user })
    release()

    expect(await outcome).toBe('sent')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toBe(sentBy('1', 'ada-2'))
  })

  it('is not retried when the token it was sent with cannot be read', async () => {
    const calls: string[] = []
    httpClient.defaults.adapter = async (config) => {
      calls.push(String(config.headers.get('Authorization') ?? ''))
      const response = { data: {}, status: 401, statusText: '', headers: {}, config }
      throw new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, response)
    }
    initAuth()
    startSession({ accessToken: 'not-a-jwt', user: session.user })
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await expect(httpClient.post('/tasks', {})).rejects.toMatchObject({ response: { status: 401 } })

    expect(calls).toEqual(['Bearer not-a-jwt'])
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

  it('never leaves the status unknown when the session changed while it was waiting', async () => {
    let reject: (reason: unknown) => void = () => undefined
    vi.mocked(authApi.refresh).mockReturnValue(
      new Promise((_resolve, rej) => {
        reject = rej
      }),
    )

    const done = retryBootstrap()
    await vi.advanceTimersByTimeAsync(0)
    startSession(session)
    useAuthStore.setState({ status: 'unknown' })
    reject(httpError(503))
    await done

    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('does not retry when the server says too many attempts', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(httpError(429))

    await retryBootstrap()

    expect(authApi.refresh).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().status).toBe('rateLimited')
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('tries again from scratch when asked, after the server was unavailable', async () => {
    useAuthStore.setState({ status: 'unavailable' })
    vi.mocked(authApi.refresh).mockResolvedValue(session)

    await retryBootstrap()

    expect(useAuthStore.getState().status).toBe('authenticated')
  })
})
