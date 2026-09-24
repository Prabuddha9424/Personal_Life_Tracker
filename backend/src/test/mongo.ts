import { createServer, type AddressInfo } from 'node:net'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

let server: MongoMemoryServer | undefined

/**
 * A port nothing holds on 127.0.0.1, where mongod binds. mongodb-memory-server probes with a
 * wildcard bind, which on macOS also "succeeds" for ports another process holds on 127.0.0.1
 * (see http.ts), so mongod then dies with `Port "N" already in use`.
 */
async function freeLoopbackPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** Starts an in-memory MongoDB and connects the default mongoose connection to it. */
export async function startTestDb(): Promise<void> {
  server = await MongoMemoryServer.create({
    // mongod's default 10 s startup limit is missed when several test runs share a busy machine.
    instance: { port: await freeLoopbackPort(), launchTimeout: 60_000 },
  })
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
