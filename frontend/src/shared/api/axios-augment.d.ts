import 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    /** How many cold-start retries this request has used. Set by installColdStartRetry. */
    coldStartAttempt?: number
    /** Set on the refresh call itself so a 401 there never triggers another refresh. */
    skipAuthRefresh?: boolean
    /** Set once a request has been retried after a session refresh. */
    authRetried?: boolean
  }
}
