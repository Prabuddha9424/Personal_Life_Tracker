import type { RequestHandler, Router } from 'express'
import { describe, expect, it } from 'vitest'
import { authRateLimiter, refreshRateLimiter } from '../../shared/middleware/rateLimiters.ts'
import { authRouter } from './auth.routes.ts'

interface RouteLayer {
  route?: { path: string; stack: { handle: RequestHandler }[] }
}

// The limiters are skipped when NODE_ENV=test, so which one guards a route is checked on the router.
function handlersOf(router: Router, path: string): RequestHandler[] {
  const layer = (router.stack as RouteLayer[]).find((entry) => entry.route?.path === path)
  return layer?.route?.stack.map((item) => item.handle) ?? []
}

describe('auth route rate limiting', () => {
  it('gives refresh its own limiter so page loads do not spend the login budget', () => {
    const handlers = handlersOf(authRouter, '/refresh')

    expect(handlers).toContain(refreshRateLimiter)
    expect(handlers).not.toContain(authRateLimiter)
    expect(refreshRateLimiter).not.toBe(authRateLimiter)
  })

  it.each(['/login', '/verify-email', '/reset-password', '/change-password'])(
    'guards %s with the strict limiter',
    (path) => {
      const handlers = handlersOf(authRouter, path)

      expect(handlers).toContain(authRateLimiter)
      expect(handlers).not.toContain(refreshRateLimiter)
    },
  )
})
