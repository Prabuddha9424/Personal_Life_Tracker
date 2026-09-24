import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.ts'
import { clearTestDb, startTestDb, stopTestDb } from '../../test/mongo.ts'
import { request } from '../../test/http.ts'
import { refreshCookie, registerVerified, sendMailMock } from './auth.test-helpers.ts'

const logged = vi.hoisted(() => ({ lines: [] as string[] }))

// The app's request logger writes to memory, but with the real redact configuration.
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
vi.mock('../../shared/mailer/mailer.ts', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }))

beforeAll(startTestDb)
afterEach(clearTestDb)
afterAll(stopTestDb)

describe('request logging', () => {
  it('never writes the raw refresh token to the log', async () => {
    const user = await registerVerified()
    sendMailMock.mockClear()
    logged.lines.length = 0

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200)
    const rawToken = refreshCookie(res).slice('refresh_token='.length)

    const output = logged.lines.join('')
    expect(rawToken).toMatch(/^[\w-]{20,}$/)
    expect(output).toContain('/api/auth/login')
    expect(output).not.toContain(rawToken)
    expect(output).toContain('[Redacted]')
  })
})
