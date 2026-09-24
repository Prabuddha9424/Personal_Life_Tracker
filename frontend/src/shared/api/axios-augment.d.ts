import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** How many cold-start retries this request has used. Set by installColdStartRetry. */
    coldStartAttempt?: number
  }
}
