import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { redirectTarget } from '../redirectTarget'
import { useAuthStore } from '../store/authStore'

/**
 * For pages only signed-out visitors need: login, register, forgot password. Once signed in (for
 * example by the login form itself) it sends the user to the page they were originally heading to.
 */
export function GuestRoute() {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  if (status === 'authenticated') return <Navigate to={redirectTarget(location.state)} replace />
  if (status === 'anonymous') return <Outlet />
  return <LoadingState label="Loading your account…" />
}
