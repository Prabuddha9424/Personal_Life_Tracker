import { rateLimit, type Options } from 'express-rate-limit'
import { env } from '../config/env.ts'

interface LimiterOptions {
  windowMs: number
  limit: number
  skip?: Options['skip']
}

export function createRateLimiter({ windowMs, limit, skip }: LimiterOptions) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later' },
  })
}

// Supertest sends every request from one address, so the app-level limiters are off in tests.
// createRateLimiter itself is tested directly above.
const skipInTests = () => env.NODE_ENV === 'test'

/** Login, refresh, verify, reset and other auth endpoints. */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: skipInTests,
})

/** Endpoints that send an email (register, resend, forgot password). */
export const mailRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  skip: skipInTests,
})

/** Internal endpoints called by the scheduler. */
export const internalRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  skip: skipInTests,
})
