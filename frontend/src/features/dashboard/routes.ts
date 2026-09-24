import type { RouteObject } from 'react-router'

export const dashboardRoutes: RouteObject[] = [
  {
    index: true,
    lazy: async () => ({ Component: (await import('./pages/DashboardPage')).default }),
  },
]
