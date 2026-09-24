import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let server: MongoMemoryServer | undefined

/** Starts an in-memory MongoDB and connects the default mongoose connection to it. */
export async function startTestDb(): Promise<void> {
  server = await MongoMemoryServer.create()
  await mongoose.connect(server.getUri('test'))
  // Models are registered on import, so this builds their unique and TTL indexes.
  await mongoose.syncIndexes()
}

/** Empties every collection but keeps the indexes. Call in afterEach. */
export async function clearTestDb(): Promise<void> {
  const collections = (await mongoose.connection.db?.collections()) ?? []
  await Promise.all(collections.map((collection) => collection.deleteMany({})))
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect()
  await server?.stop()
  server = undefined
}
