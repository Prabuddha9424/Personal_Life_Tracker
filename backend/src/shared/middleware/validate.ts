import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

interface RequestSchemas {
  body?: ZodType
  params?: ZodType
  query?: ZodType
}

/**
 * Validates and replaces req.body / req.params / req.query with the parsed values.
 * A ZodError is thrown on failure and formatted by errorHandler.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body)
    if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
    // req.query is a getter in Express 5, so it must be redefined rather than assigned.
    if (schemas.query) {
      Object.defineProperty(req, 'query', { value: schemas.query.parse(req.query) })
    }
    next()
  }
}
