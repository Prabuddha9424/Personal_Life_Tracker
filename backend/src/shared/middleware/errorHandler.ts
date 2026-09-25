import type { ErrorRequestHandler } from 'express'
import mongoose from 'mongoose'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.ts'
import { AppError } from '../errors/AppError.ts'
import { isDuplicateKeyError } from '../errors/isDuplicateKeyError.ts'
import { logger } from '../logger/logger.ts'
import { pathOnly } from '../logger/pathOnly.ts'

interface ErrorBody {
  message: string
  errors?: { path: string; message: string }[]
}

function isBodyParseError(err: unknown): boolean {
  return err instanceof SyntaxError && 'status' in err && err.status === 400
}

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  413: 'Request body too large',
  415: 'Unsupported media type',
}

/**
 * The status and message for an error from body-parser or another http-errors source that marks
 * itself safe to show the client (`expose`) with a 4xx status. 5xx errors are never exposed.
 */
function exposedClientError(err: unknown): { status: number; message: string } | undefined {
  if (!(err instanceof Error) || !('expose' in err) || err.expose !== true) return undefined
  const status = 'status' in err ? err.status : 'statusCode' in err ? err.statusCode : undefined
  if (typeof status !== 'number' || status < 400 || status >= 500) return undefined
  return { status, message: CLIENT_ERROR_MESSAGES[status] ?? err.message }
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let status = 500
  const body: ErrorBody = { message: 'Internal server error' }
  const clientError = exposedClientError(err)

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
  } else if (err instanceof mongoose.Error.ValidationError) {
    // Its messages quote the offending value, so only the paths are reported.
    status = 400
    body.message = 'Validation failed'
    body.errors = Object.keys(err.errors).map((path) => ({ path, message: 'Invalid value' }))
  } else if (isDuplicateKeyError(err)) {
    status = 409
    body.message = 'Resource already exists'
  } else if (isBodyParseError(err)) {
    status = 400
    body.message = 'Malformed JSON body'
  } else if (clientError) {
    status = clientError.status
    body.message = clientError.message
  }

  if (status >= 500) {
    logger.error({ err, method: req.method, url: pathOnly(req.originalUrl) }, 'Unhandled error')
    if (!isProduction && err instanceof Error) body.message = err.message
  }

  res.status(status).json(body)
}
