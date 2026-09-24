import { Navigate, Outlet } from 'react-router'
import { LoadingState } from '@/shared/ui/StateViews'
import { useAuthStore } from '../store/authStore'

/** For pages only signed-out visitors need: login, register, forgot password. */
export function GuestRoute() {
  const status = useAuthStore((state) => state.status)

  if (status === 'unknown') return <LoadingState label="Loading your account…" />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
