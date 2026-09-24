import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { env } from '../config/env.ts'
import { AppError } from '../errors/AppError.ts'

const digest = (value: string) => createHash('sha256').update(value).digest()

/** Guards endpoints that only the scheduler may call. Not tied to any user. */
export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const provided = req.get('x-cron-secret') ?? ''
  // Hashing first gives both sides the same length, so timingSafeEqual never throws or leaks it.
  if (!timingSafeEqual(digest(provided), digest(env.CRON_SECRET))) {
    throw new AppError(401, 'Not authorized')
  }
  next()
}
