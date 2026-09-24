import { Router } from 'express'
import { requireAuth } from '../../shared/middleware/requireAuth.ts'
import { authRateLimiter, mailRateLimiter } from '../../shared/middleware/rateLimiters.ts'
import { validate } from '../../shared/middleware/validate.ts'
import { registerSchema, resendVerificationSchema, verifyEmailSchema } from './auth.schemas.ts'
import { me } from './profile.controller.ts'
import { register, resendVerification, verifyEmail } from './registration.controller.ts'

export const authRouter = Router()

authRouter.post('/register', mailRateLimiter, validate({ body: registerSchema }), register)
authRouter.post('/verify-email', authRateLimiter, validate({ body: verifyEmailSchema }), verifyEmail)
authRouter.post(
  '/resend-verification',
  mailRateLimiter,
  validate({ body: resendVerificationSchema }),
  resendVerification,
)
authRouter.get('/me', requireAuth, me)
