import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

/** The cold-start interceptor already retried these, so a second cycle would only add delay. */
function isGatewayOrOffline(error: unknown): boolean {
  if (!isAxiosError(error)) return false
  const status = error.response?.status
  return status === undefined || status === 502 || status === 503 || status === 504
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => failureCount < 1 && !isGatewayOrOffline(error),
      refetchOnWindowFocus: false,
    },
  },
})
