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

/** Login, verify, reset and change-password. Deliberately strict: these take guessable input. */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: skipInTests,
})

/**
 * Refresh runs on every page load and access-token expiry, so it needs its own, looser budget.
 * Sharing the login counter would let ordinary reloads lock users out of logging in. The token is
 * 256 bits, so guessing it is not the concern here.
 */
export const refreshRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 100,
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
