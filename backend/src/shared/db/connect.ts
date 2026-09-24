import mongoose from 'mongoose'
import { env } from '../config/env.ts'
import { logger } from '../logger/logger.ts'

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.MONGODB_URI)
  logger.info('MongoDB connected')
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected
}
