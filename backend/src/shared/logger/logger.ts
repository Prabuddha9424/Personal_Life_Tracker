import { pino, type LoggerOptions, type SerializedRequest } from 'pino'
import { env, isProduction } from '../config/env.ts'
import { pathOnly } from './pathOnly.ts'

export const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  serializers: {
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
