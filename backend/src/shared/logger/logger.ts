import { pino } from 'pino'
import { env, isProduction } from '../config/env.ts'

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProduction ? 'info' : 'debug',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
  ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
})
