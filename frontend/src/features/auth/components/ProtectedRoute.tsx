import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useAuthStore } from '../store/authStore'

export function ProtectedRoute() {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  if (status === 'authenticated') return <Outlet />
  if (status === 'anonymous') {
    const from = location.pathname + location.search + location.hash
    return <Navigate to="/login" replace state={{ from }} />
  }
  return <LoadingState label="Loading your account…" />
}
