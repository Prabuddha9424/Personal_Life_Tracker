import { createBrowserRouter } from 'react-router'
import { dashboardRoutes } from '@/features/dashboard'
import { NotFoundPage } from '@/shared/ui/NotFoundPage'
import { RootLayout } from './RootLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [...dashboardRoutes, { path: '*', Component: NotFoundPage }],
  },
])
