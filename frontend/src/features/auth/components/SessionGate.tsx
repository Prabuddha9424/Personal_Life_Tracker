import { useEffect, type ReactNode } from 'react'
import { bootstrapSession } from '../session'

/** Restores the session from the refresh cookie once, when the app starts. */
export function SessionGate({ children }: { children: ReactNode }) {
  useEffect(() => {
    void bootstrapSession()
  }, [])

  return <>{children}</>
}
