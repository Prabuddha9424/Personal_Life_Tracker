import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import {
  authRateLimiter,
  mailRateLimiter,
  refreshRateLimiter,
} from '../../shared/middleware/rateLimiters.ts'
import { validate } from '../../shared/middleware/validate.ts'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schemas.ts'
import { changePassword, forgotPassword, resetPassword } from './password.controller.ts'
import { me, updateMe } from './profile.controller.ts'
import { register, resendVerification, verifyEmail } from './registration.controller.ts'
import { login, logout, refresh } from './session.controller.ts'

export const authRouter = Router()

authRouter.post('/register', mailRateLimiter, validate({ body: registerSchema }), register)
authRouter.post(
  '/verify-email',
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  verifyEmail,
)
authRouter.post(
  '/resend-verification',
  mailRateLimiter,
  validate({ body: resendVerificationSchema }),
  resendVerification,
)
authRouter.get('/me', requireAuth, me)
authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), login)
authRouter.post('/refresh', refreshRateLimiter, refresh)
authRouter.post('/logout', logout)
authRouter.post(
  '/forgot-password',
  mailRateLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPassword,
)
authRouter.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  resetPassword,
)
authRouter.post(
  '/change-password',
  authRateLimiter,
  requireAuth,
  validate({ body: changePasswordSchema }),
  changePassword,
)
authRouter.patch('/me', requireAuth, validate({ body: updateProfileSchema }), updateMe)
