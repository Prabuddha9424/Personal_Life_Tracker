import { Outlet } from 'react-router'
import { ServerStatusBanner } from '@/shared/ui/ServerStatusBanner'
import { ToastHost } from '@/shared/ui/ToastHost'

export function RootLayout() {
  return (
    <>
      <ServerStatusBanner />
      <Outlet />
      <ToastHost />
    </>
  )
}
