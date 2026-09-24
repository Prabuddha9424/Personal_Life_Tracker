import axios from 'axios'
import { env } from '@/shared/config/env'
import { installColdStartRetry } from './coldStartRetry'

type TokenGetter = () => string | null
type UnauthorizedHandler = () => void

let getAccessToken: TokenGetter = () => null
let onUnauthorized: UnauthorizedHandler = () => {}

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

httpClient.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) onUnauthorized()
    return Promise.reject(error)
  },
)

installColdStartRetry(httpClient)

/** Extracts the `{ message }` from an API error, falling back to a generic message. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? error.message
  }
  return 'Something went wrong'
}
