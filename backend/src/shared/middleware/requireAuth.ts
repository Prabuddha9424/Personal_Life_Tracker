import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../auth/token.ts'
import { AppError } from '../errors/AppError.ts'

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const payload = token ? verifyAccessToken(token) : null

  if (!payload) throw new AppError(401, 'Not authorized')

  req.user = { id: payload.sub }
  next()
}
