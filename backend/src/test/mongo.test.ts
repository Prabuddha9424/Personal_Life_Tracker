import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clearTestDb, startTestDb, stopTestDb } from './mongo.ts'

describe('test database helper', () => {
  beforeAll(startTestDb)
  afterAll(stopTestDb)

  it('connects to an in-memory MongoDB', () => {
    expect(mongoose.connection.readyState).toBe(mongoose.ConnectionStates.connected)
  })

  it('clears every collection', async () => {
    const items = mongoose.connection.collection('items')
    await items.insertOne({ name: 'a' })

    await clearTestDb()

    expect(await items.countDocuments()).toBe(0)
  })
})
