import { rateLimit } from 'express-rate-limit'

/** Strict limiter for login, register, and password reset endpoints. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later' },
})
