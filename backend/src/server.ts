import { app } from './app.ts'
import { env } from './shared/config/env.ts'
import { connectDatabase, disconnectDatabase } from './shared/db/connect.ts'
import { logger } from './shared/logger/logger.ts'

if (env.NODE_ENV === 'test') {
  // The app-level rate limiters are disabled in test, so a real server must never run this way.
  process.stderr.write('Refusing to start: NODE_ENV=test disables the rate limiters.\n')
  process.exit(1)
}

await connectDatabase()

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} (${env.NODE_ENV})`)
})

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`)
  server.close(() => {
    void disconnectDatabase().then(() => process.exit(0))
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
