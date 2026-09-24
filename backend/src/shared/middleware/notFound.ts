import type { RequestHandler } from 'express'
import { AppError } from '../errors/AppError.ts'

export const notFound: RequestHandler = (req) => {
  throw new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`)
}
