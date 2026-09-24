import type { RouteObject } from 'react-router'
import { GuestRoute } from './components/GuestRoute'

export const authRoutes: RouteObject[] = [
  {
    Component: GuestRoute,
    children: [
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('./pages/LoginPage')).default }),
      },
      {
        path: 'register',
        lazy: async () => ({ Component: (await import('./pages/RegisterPage')).default }),
      },
      {
        path: 'forgot-password',
        lazy: async () => ({ Component: (await import('./pages/ForgotPasswordPage')).default }),
      },
    ],
  },
  {
    path: 'verify-email',
    lazy: async () => ({ Component: (await import('./pages/VerifyEmailPage')).default }),
  },
  {
    path: 'reset-password',
    lazy: async () => ({ Component: (await import('./pages/ResetPasswordPage')).default }),
  },
]
