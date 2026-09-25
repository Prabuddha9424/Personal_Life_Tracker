import type { RouteObject } from 'react-router'

export const financeRoutes: RouteObject[] = [
  {
    path: 'finance',
    lazy: async () => ({ Component: (await import('./pages/FinancePage')).default }),
  },
]
