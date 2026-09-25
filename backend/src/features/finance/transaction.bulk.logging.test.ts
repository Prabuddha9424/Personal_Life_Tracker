import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { insertCategory } from './finance.test-helpers.ts'
import { Transaction } from './transaction.model.ts'

const logged = vi.hoisted(() => ({ lines: [] as string[] }))

// Every logger writes to memory, with the REAL serializers and redaction of the app.
vi.mock('../../shared/logger/logger.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/logger/logger.ts')>()
  return {
    ...actual,
    logger: pino(
      { ...actual.loggerOptions, transport: undefined, level: 'info' },
      {
        write: (line: string) => {
          logged.lines.push(line)
        },
      },
    ),
  }
})
vi.mock(import('../auth/index.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  getUserProfile: async (id: string) => ({
    id,
    email: `${id}@example.com`,
    name: 'Test',
    currency: 'USD',
  }),
}))

beforeAll(startTestDb)
beforeEach(() => {
  logged.lines.length = 0
})
afterEach(async () => {
  vi.restoreAllMocks()
  await clearTestDb()
})
afterAll(stopTestDb)

const SECRET_NOTE = 'SECRET-NOTE'
const SECRET_AMOUNT = 7654321
const alice = testUser()

async function rows() {
  const food = await insertCategory(alice.id, { kind: 'expense' })
  const row = (note: string, amountMinor = 500) => ({
    kind: 'expense',
    amountMinor,
    categoryId: food._id.toString(),
    date: '2026-09-01',
    note,
  })
  return [row('fine'), row(SECRET_NOTE, SECRET_AMOUNT), row('also fine')]
}

const bulk = (body: unknown[]) =>
  request(app).post('/api/transactions/bulk').set(alice.headers).send({ rows: body })

describe('logging of a failed bulk import', () => {
  it('logs the message, code and stack of a write error but none of the rows it carries', async () => {
    const body = await rows()
    const err = Object.assign(new Error('Document failed validation'), {
      name: 'MongoBulkWriteError',
      code: 121,
      writeErrors: [{ err: { op: { note: SECRET_NOTE, amountMinor: SECRET_AMOUNT } } }],
      insertedDocs: [{ note: SECRET_NOTE }],
      errorResponse: { writeErrors: [{ err: { op: { note: SECRET_NOTE } } }] },
    })
    vi.spyOn(Transaction, 'insertMany').mockRejectedValueOnce(err)

    const res = await bulk(body)

    expect(res.status).toBe(500)
    const output = logged.lines.join('')
    expect(output).toContain('Unhandled error')
    expect(output).toContain('Document failed validation')
    expect(output).toContain('"code":121')
    expect(output).toContain('"stack"')
    expect(output).not.toContain(SECRET_NOTE)
    expect(output).not.toContain(String(SECRET_AMOUNT))
  })

  it('logs no row text or amount for a real server-side write failure mid-batch', async () => {
    const body = await rows()
    await Transaction.createCollection()
    await Transaction.db.db?.command({
      collMod: Transaction.collection.collectionName,
      validator: { note: { $ne: SECRET_NOTE } },
      validationLevel: 'strict',
      validationAction: 'error',
    })

    const res = await bulk(body)

    expect(res.status).toBe(500)
    expect(await Transaction.countDocuments()).toBe(0)
    const output = logged.lines.join('')
    expect(output).toContain('Unhandled error')
    expect(output).not.toContain(SECRET_NOTE)
    expect(output).not.toContain(String(SECRET_AMOUNT))
  })

  it('logs no row text when the cleanup fails as well', async () => {
    const body = await rows()
    vi.spyOn(Transaction, 'insertMany').mockRejectedValueOnce(new Error('connection lost'))
    vi.spyOn(Transaction, 'deleteMany').mockRejectedValueOnce(
      Object.assign(new Error('cleanup refused'), {
        writeErrors: [{ err: { op: { note: SECRET_NOTE } } }],
      }),
    )

    await bulk(body)

    const output = logged.lines.join('')
    expect(output).toContain('cleaned up')
    expect(output).toContain('cleanup refused')
    expect(output).not.toContain(SECRET_NOTE)
  })
})
