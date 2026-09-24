import { Outlet } from 'react-router'
import { ToastHost } from '@/shared/ui/ToastHost'

export function RootLayout() {
  return (
    <>
      <Outlet />
      <ToastHost />
    </>
  )
}
