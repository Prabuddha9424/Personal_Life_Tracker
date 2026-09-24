import axios from 'axios'
import { env } from '@/shared/config/env'
import { installColdStartRetry } from './coldStartRetry'

type TokenGetter = () => string | null
/**
 * Tries to obtain a fresh access token for a request that was answered 401. Receives the
 * Authorization header that request was SENT with, so the handler can tell whose request it is.
 * Resolves true only when that request may be sent again.
 */
type UnauthorizedHandler = (sentAuthorization: string) => Promise<boolean>

let getAccessToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = async () => false

/**
 * Lets the auth slice plug in token handling without shared/ depending on features/.
 */
export function configureAuth(options: {
  getToken: TokenGetter
  onUnauthorized: UnauthorizedHandler
}) {
  getAccessToken = options.getToken
  onUnauthorized = options.onUnauthorized
}

export const httpClient = axios.create({
  baseURL: env.VITE_API_URL,
  withCredentials: true,
})

/**
 * The token is stamped once, when a request is first sent. A resend of the same request (the
 * cold-start retry) keeps that token instead of picking up whoever is signed in by then, so a
 * request sent by one user is never carried out as the next one. A retry after a session refresh
 * clears the header on purpose to get the renewed token.
 */
httpClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const config = error.config
      // Only requests that carried a token can have an expired session; a bare 401 (wrong
      // password) must not trigger a refresh.
      const sent = config?.headers.Authorization
      if (config && !config.skipAuthRefresh && !config.authRetried && sent) {
        config.authRetried = true
        if (await onUnauthorized(String(sent))) {
          config.headers.delete('Authorization')
          return httpClient.request(config)
        }
      }
    }
    return Promise.reject(error)
  },
)

installColdStartRetry(httpClient)

/**
 * Extracts the `{ message }` from an API error, falling back to a generic message. A gateway
 * timeout (502, 503, 504) or no response at all usually means the free backend is waking up, so
 * say that instead of a raw Axios message (POSTs are never retried automatically).
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    const status = error.response?.status
    if (!error.response || status === 502 || status === 503 || status === 504) {
      return 'The server is waking up. Please try again in a moment.'
    }
    return error.response.data?.message ?? error.message
  }
  if (error instanceof Error) return error.message
  return 'Something went wrong'
}
