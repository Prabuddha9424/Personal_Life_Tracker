import { pino, type LoggerOptions, type SerializedRequest } from 'pino'
import { env, isProduction } from '../config/env.ts'
import { pathOnly } from './pathOnly.ts'

const ERROR_FIELDS = ['message', 'code', 'codeName', 'stack'] as const

/**
 * Logs only what identifies a failure, never what it carries. Driver and validation errors embed
 * the documents being written (`writeErrors[].err.op`, `insertedDocs`, `errorResponse`, ...), which
 * would put users' notes and amounts on the host's logs, so every other property is dropped.
 */
function serializeError(err: unknown): unknown {
  if (typeof err !== 'object' || err === null) return err
  const source = err as Record<string, unknown>
  const serialized: Record<string, unknown> = {}
  if (typeof source.name === 'string') serialized.type = source.name
  for (const field of ERROR_FIELDS) {
    if (source[field] !== undefined) serialized[field] = source[field]
  }
  return serialized
}

export const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  serializers: {
    err: serializeError,
    // Search text and filters travel in the query string and are personal data.
    req: ({ url, query: _query, ...rest }: SerializedRequest) => ({ ...rest, url: pathOnly(url) }),
  },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.token',
  ],
  ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
}

export const logger = pino(loggerOptions)
