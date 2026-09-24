import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider } from 'react-router'
import { SessionGate } from '@/features/auth'
import { queryClient } from '@/shared/lib/queryClient'
import { router } from './router'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>
        <RouterProvider router={router} />
      </SessionGate>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
