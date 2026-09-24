import { pino, type LoggerOptions } from 'pino'
import { env, isProduction } from '../config/env.ts'

export const loggerOptions: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
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
