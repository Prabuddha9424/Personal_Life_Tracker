import type { ErrorRequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.ts'
import { AppError } from '../errors/AppError.ts'
import { logger } from '../logger/logger.ts'
import { pathOnly } from '../logger/pathOnly.ts'

interface ErrorBody {
  message: string
  errors?: { path: string; message: string }[]
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000
}

function isBodyParseError(err: unknown): boolean {
  return err instanceof SyntaxError && 'status' in err && err.status === 400
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let status = 500
  const body: ErrorBody = { message: 'Internal server error' }

  if (err instanceof AppError) {
    status = err.statusCode
    body.message = err.message
  } else if (err instanceof ZodError) {
    status = 400
    body.message = 'Validation failed'
    body.errors = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400
    body.message = `Invalid ${err.path}`
  } else if (isDuplicateKeyError(err)) {
    status = 409
    body.message = 'Resource already exists'
  } else if (isBodyParseError(err)) {
    status = 400
    body.message = 'Malformed JSON body'
  }

  if (status >= 500) {
    logger.error({ err, method: req.method, url: pathOnly(req.originalUrl) }, 'Unhandled error')
    if (!isProduction && err instanceof Error) body.message = err.message
  }

  res.status(status).json(body)
}
