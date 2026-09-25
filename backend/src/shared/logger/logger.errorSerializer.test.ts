import { pino } from 'pino'
import { beforeEach, describe, expect, it } from 'vitest'
import { loggerOptions } from './logger.ts'

const lines: string[] = []
const log = pino(
  { ...loggerOptions, transport: undefined, level: 'info' },
  {
    write: (line: string) => {
      lines.push(line)
    },
  },
)

beforeEach(() => {
  lines.length = 0
})

const SECRET = 'SECRET-NOTE'

/** The shape of a driver bulk write error: it carries the documents that were being written. */
function bulkWriteError() {
  return Object.assign(new Error('Document failed validation'), {
    name: 'MongoBulkWriteError',
    code: 121,
    codeName: 'DocumentValidationFailure',
    writeErrors: [{ err: { op: { note: SECRET, amountMinor: 4242 } } }],
    insertedDocs: [{ note: SECRET }],
    errorResponse: { writeErrors: [{ errInfo: { details: { consideredValue: SECRET } } }] },
    result: { note: SECRET },
    keyValue: { note: SECRET },
    errors: { note: { value: SECRET } },
    cause: new Error(`cause with ${SECRET}`),
  })
}

describe('the err serializer', () => {
  it('keeps the name, message, code, codeName and stack, and nothing else', () => {
    const err = bulkWriteError()

    log.error({ err }, 'Unhandled error')

    const entry = JSON.parse(lines.join('')) as { err: Record<string, unknown> }
    expect(entry.err).toEqual({
      type: 'MongoBulkWriteError',
      message: 'Document failed validation',
      code: 121,
      codeName: 'DocumentValidationFailure',
      stack: expect.stringContaining('Document failed validation'),
    })
    expect(lines.join('')).not.toContain(SECRET)
  })

  it('serialises a plain error with just its type, message and stack', () => {
    log.error({ err: new TypeError('boom') }, 'x')

    const entry = JSON.parse(lines.join('')) as { err: Record<string, unknown> }
    expect(entry.err).toEqual({ type: 'TypeError', message: 'boom', stack: expect.any(String) })
  })

  it('serialises a thrown non-error object without its contents', () => {
    log.error({ err: { note: SECRET } }, 'x')

    expect(lines.join('')).not.toContain(SECRET)
  })
})
