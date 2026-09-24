import express from 'express'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { testUser } from '../../test/auth.ts'
import { request } from '../../test/http.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { errorHandler } from '../middleware/errorHandler.ts'
import { pathOnly } from './pathOnly.ts'

const logged = vi.hoisted(() => ({ lines: [] as string[] }))

// The app's loggers write to memory, but with the real serializer and redact configuration.
vi.mock('./logger.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./logger.ts')>()
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

beforeAll(startTestDb)
beforeEach(() => {
  logged.lines.length = 0
})
afterEach(clearTestDb)
afterAll(stopTestDb)

const SEARCH = 'SECRET-TASK-TEXT'
const TAG = 'secret-tag'
const urlsIn = (lines: string[]): (string | undefined)[] =>
  lines.map((line) => {
    const entry = JSON.parse(line) as { url?: string; req?: { url?: string } }
    return entry.url ?? entry.req?.url
  })

const QUERY = `q=${SEARCH}&tag=${TAG}`

describe('pathOnly', () => {
  it('drops the query string and keeps the path', () => {
    expect(pathOnly('/api/tasks?q=a&tag=b')).toBe('/api/tasks')
    expect(pathOnly('/api/tasks')).toBe('/api/tasks')
    expect(pathOnly('/api/tasks?')).toBe('/api/tasks')
  })
})

describe('query strings in logs', () => {
  it('keeps search text and tag filters out of the request log', async () => {
    const alice = testUser()

    await request(app).get(`/api/tasks?${QUERY}`).set(alice.headers).expect(200)

    const output = logged.lines.join('')
    expect(output).toContain('/api/tasks')
    expect(output).not.toContain(SEARCH)
    expect(output).not.toContain(TAG)
    expect(urlsIn(logged.lines)).toEqual(['/api/tasks'])
    expect(output).not.toContain('"query"')
    expect(output).not.toContain(alice.headers.Authorization.slice('Bearer '.length))
  })

  it('keeps search text and tag filters out of the error log', async () => {
    const failing = express()
    failing.get('/api/boom', () => {
      throw new Error('boom')
    })
    failing.use(errorHandler)

    await request(failing).get(`/api/boom?${QUERY}`).expect(500)

    const output = logged.lines.join('')
    expect(output).toContain('Unhandled error')
    expect(output).toContain('/api/boom')
    expect(output).not.toContain(SEARCH)
    expect(output).not.toContain(TAG)
    expect(urlsIn(logged.lines)).toEqual(['/api/boom'])
  })
})
