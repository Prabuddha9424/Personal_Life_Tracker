import { createBrowserRouter } from 'react-router'
import { authRoutes, ProtectedRoute } from '@/features/auth'
import { dashboardRoutes } from '@/features/dashboard'
import { taskRoutes } from '@/features/tasks'
import { NotFoundPage } from '@/shared/ui/NotFoundPage'
import { AppShell } from './AppShell'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      ...authRoutes,
      {
        Component: ProtectedRoute,
        children: [{ Component: AppShell, children: [...dashboardRoutes, ...taskRoutes] }],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
])
