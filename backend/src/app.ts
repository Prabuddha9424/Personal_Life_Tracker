import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { authRouter } from './features/auth/index.ts'
import { financeRouter } from './features/finance/index.ts'
import { healthRouter } from './features/health/index.ts'
import { taskRouter } from './features/tasks/index.ts'
import { env } from './shared/config/env.ts'
import { logger, loggerOptions } from './shared/logger/logger.ts'
import { errorHandler } from './shared/middleware/errorHandler.ts'
import { notFound } from './shared/middleware/notFound.ts'

export const app = express()

app.disable('x-powered-by')
app.set('trust proxy', env.TRUST_PROXY_HOPS)
app.use(helmet())
app.use(cors({ origin: env.CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use(pinoHttp({ logger, serializers: loggerOptions.serializers }))

// Feature slices
app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/tasks', taskRouter)
app.use('/api', financeRouter)

app.use(notFound)
app.use(errorHandler)
