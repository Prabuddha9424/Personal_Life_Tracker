import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it } from 'vitest'
import { installColdStartRetry } from './coldStartRetry'
import { useServerStatus } from './serverStatus'

function gatewayError(config: InternalAxiosRequestConfig, status: number) {
  return new AxiosError('Gateway error', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config,
  })
}

/** An axios client whose server fails `failures` times with `status`, then answers 200. */
function buildClient(failures: number, status: number, options = { delayMs: 0, maxAttempts: 5 }) {
  const state = { calls: 0 }
  const client = axios.create({
    adapter: async (config) => {
      state.calls += 1
      if (state.calls <= failures) throw gatewayError(config, status)
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
    },
  })
  installColdStartRetry(client, options)
  return { client, state }
}

describe('installColdStartRetry', () => {
  beforeEach(() => {
    useServerStatus.getState().setWaking(false)
  })

  it('retries a GET that gets a gateway timeout until the server answers', async () => {
    const { client, state } = buildClient(2, 504)

    const response = await client.get('/health')

    expect(response.data).toEqual({ ok: true })
    expect(state.calls).toBe(3)
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('shows the waking state while it waits between attempts', async () => {
    const seen: boolean[] = []
    const unsubscribe = useServerStatus.subscribe((state) => seen.push(state.waking))
    const { client } = buildClient(1, 503)

    await client.get('/health')
    unsubscribe()

    expect(seen).toContain(true)
    expect(seen.at(-1)).toBe(false)
  })

  it('never retries a POST', async () => {
    const { client, state } = buildClient(5, 504)

    await expect(client.post('/tasks', {})).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(1)
    expect(useServerStatus.getState().waking).toBe(false)
  })

  it('does not retry client errors', async () => {
    const { client, state } = buildClient(5, 404)

    await expect(client.get('/missing')).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(1)
  })

  it('gives up after the maximum number of retries', async () => {
    const { client, state } = buildClient(99, 502, { delayMs: 0, maxAttempts: 2 })

    await expect(client.get('/health')).rejects.toBeInstanceOf(AxiosError)

    expect(state.calls).toBe(3)
    expect(useServerStatus.getState().waking).toBe(false)
  })
})
