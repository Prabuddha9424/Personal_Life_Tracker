import type { RouteObject } from 'react-router'

export const taskRoutes: RouteObject[] = [
  {
    path: 'board',
    lazy: async () => ({ Component: (await import('./pages/BoardPage')).default }),
  },
]
