import axios, { type AxiosInstance } from 'axios'
import { useServerStatus } from './serverStatus'

const GATEWAY_STATUSES = new Set([502, 503, 504])
const SAFE_METHODS = new Set(['get', 'head'])

interface ColdStartOptions {
  maxAttempts?: number
  delayMs?: number
}

/** True when the failure looks like a sleeping server: a gateway error, or no response at all. */
function looksLikeWakingServer(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.code === 'ERR_CANCELED') return false
  return !error.response || GATEWAY_STATUSES.has(error.response.status)
}

/**
 * Retries safe requests while a free-tier backend wakes up. Only GET and HEAD are retried:
 * a POST that timed out may already have been processed, and repeating it could duplicate data.
 */
export function installColdStartRetry(
  client: AxiosInstance,
  { maxAttempts = 5, delayMs = 5000 }: ColdStartOptions = {},
): void {
  const { setWaking } = useServerStatus.getState()

  client.interceptors.response.use(
    (response) => {
      setWaking(false)
      return response
    },
    async (error: unknown) => {
      const config = axios.isAxiosError(error) ? error.config : undefined
      const attempt = config?.coldStartAttempt ?? 0
      const method = config?.method?.toLowerCase() ?? ''

      if (
        config &&
        SAFE_METHODS.has(method) &&
        looksLikeWakingServer(error) &&
        attempt < maxAttempts
      ) {
        config.coldStartAttempt = attempt + 1
        setWaking(true)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        return client.request(config)
      }

      setWaking(false)
      return Promise.reject(error)
    },
  )
}
