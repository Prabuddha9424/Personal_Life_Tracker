import { useEffect, type ReactNode } from 'react'
import { ErrorState } from '@/shared/ui/StateViews'
import { bootstrapSession, retryBootstrap } from '../session'
import { useAuthStore } from '../store/authStore'
import '../auth.css'

/**
 * Restores the session from the refresh cookie once, when the app starts. If the server stays
 * unreachable, says so instead of sending a returning user to the login page.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)

  useEffect(() => {
    void bootstrapSession()
  }, [])

  if (status === 'unavailable' || status === 'rateLimited') {
    return (
      <div className="auth">
        <ErrorState
          message={
            status === 'rateLimited'
              ? 'Too many attempts. Please wait a few minutes and try again.'
              : 'We could not reach the server. It may still be starting up.'
          }
          onRetry={() => void retryBootstrap()}
        />
      </div>
    )
  }
  return <>{children}</>
}
