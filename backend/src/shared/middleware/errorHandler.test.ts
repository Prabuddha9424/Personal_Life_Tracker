import express from 'express'
import { pino } from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import mongoose from 'mongoose'
import { app } from '../../app.ts'
import { request } from '../../test/http.ts'
import { errorHandler } from './errorHandler.ts'

const logged = vi.hoisted(() => ({ lines: [] as string[] }))

vi.mock('../logger/logger.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logger/logger.ts')>()
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

beforeEach(() => {
  logged.lines.length = 0
})

const ERROR_LEVEL = 50
const errorLines = () =>
  logged.lines.filter((line) => (JSON.parse(line) as { level: number }).level >= ERROR_LEVEL)

/** An app whose only route fails with the given error. */
function failingApp(err: unknown) {
  const failing = express()
  failing.get('/boom', () => {
    throw err
  })
  failing.use(errorHandler)
  return failing
}

const failWith = (err: unknown) => request(failingApp(err)).get('/boom')

describe('request bodies the parser refuses', () => {
  it('answers a body over the 100 KB limit with 413, a clear message and no error log', async () => {
    const res = await request(app)
      .post('/api/transactions/bulk')
      .send({ rows: [{ note: 'x'.repeat(120 * 1024) }] })

    expect(res.status).toBe(413)
    expect(res.body).toEqual({ message: 'Request body too large' })
    expect(errorLines()).toHaveLength(0)
  })

  it('still answers malformed JSON with 400 and its own message', async () => {
    const res = await request(app)
      .post('/api/transactions/bulk')
      .set('Content-Type', 'application/json')
      .send('{"rows": [')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Malformed JSON body' })
  })
})

describe('client errors carrying an exposable status', () => {
  it.each([
    [415, 'Unsupported media type'],
    [413, 'Request body too large'],
  ])('maps status %i to a fixed message', async (status, message) => {
    const res = await failWith(
      Object.assign(new Error('internal detail'), { status, expose: true }),
    )

    expect(res.status).toBe(status)
    expect(res.body).toEqual({ message })
    expect(errorLines()).toHaveLength(0)
  })

  it('passes the message of another exposable 4xx through, reading statusCode too', async () => {
    const res = await failWith(
      Object.assign(new Error('request aborted'), { statusCode: 400, expose: true }),
    )

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'request aborted' })
  })

  it('ignores a 4xx that is not marked exposable', async () => {
    const res = await failWith(Object.assign(new Error('private'), { status: 404 }))

    expect(res.status).toBe(500)
    expect(errorLines()).toHaveLength(1)
  })

  it('never exposes a 5xx, even one marked exposable', async () => {
    const res = await failWith(
      Object.assign(new Error('database password is hunter2'), { status: 503, expose: true }),
    )

    expect(res.status).toBe(500)
    expect(errorLines()).toHaveLength(1)
  })
})

describe('duplicate key errors', () => {
  it('maps a single duplicate key error to 409', async () => {
    const res = await failWith(Object.assign(new Error('E11000'), { code: 11000 }))

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ message: 'Resource already exists' })
  })

  it('maps a bulk error in which every failure is a duplicate to 409', async () => {
    const res = await failWith(
      Object.assign(new Error('bulk'), {
        code: 11000,
        writeErrors: [{ err: { code: 11000 } }, { err: { code: 11000 } }],
      }),
    )

    expect(res.status).toBe(409)
  })

  it('does not treat a bulk error that mixes duplicates with other failures as a duplicate', async () => {
    const res = await failWith(
      Object.assign(new Error('bulk'), {
        code: 11000,
        writeErrors: [{ err: { code: 11000 } }, { err: { code: 121 } }],
      }),
    )

    expect(res.status).toBe(500)
    expect(errorLines()).toHaveLength(1)
  })
})

describe('Mongoose validation errors', () => {
  const SECRET = 'SECRET-LONG-NOTE'

  async function validationError() {
    const Note = mongoose.model(
      'ErrorHandlerNote',
      new mongoose.Schema({ note: { type: String, maxlength: 3 } }),
    )
    return Note.create({ note: SECRET }).catch((err: unknown) => err)
  }

  it('answers with a 400 that names the path but never the value, and logs no error', async () => {
    const err = await validationError()
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError)

    const res = await failWith(err)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      message: 'Validation failed',
      errors: [{ path: 'note', message: 'Invalid value' }],
    })
    expect(JSON.stringify(res.body)).not.toContain(SECRET)
    expect(logged.lines.join('')).not.toContain(SECRET)
    expect(errorLines()).toHaveLength(0)
  })
})
