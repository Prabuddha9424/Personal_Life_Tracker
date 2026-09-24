import { createBrowserRouter } from 'react-router'
import { dashboardRoutes } from '@/features/dashboard'
import { NotFoundPage } from '@/shared/ui/NotFoundPage'
import { AppShell } from './AppShell'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { Component: AppShell, children: [...dashboardRoutes] },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
