import type { Request } from 'express'
import { AppError } from '../errors/AppError.ts'

/** The authenticated user's id. Never read a user id from the request body, params or query. */
export function authUserId(req: Request): string {
  if (!req.user) throw new AppError(401, 'Not authorized')
  return req.user.id
}
