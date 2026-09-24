import { describe, expect, it } from 'vitest'
import { isDuplicateKeyError } from './isDuplicateKeyError.ts'

const DUPLICATE = 11000
const VALIDATION_FAILED = 121

/** The shape Mongoose's insertMany throws: entries wrap the driver error as `{ err, index }`. */
const bulkError = (topLevelCode: number, ...codes: number[]) =>
  Object.assign(new Error('bulk write failed'), {
    code: topLevelCode,
    writeErrors: codes.map((code, index) => ({ index, err: { code } })),
  })

describe('isDuplicateKeyError', () => {
  it('tolerates a plain single-document duplicate-key error', () => {
    expect(isDuplicateKeyError(Object.assign(new Error('E11000'), { code: DUPLICATE }))).toBe(true)
  })

  it('does not tolerate other single-document errors or non-errors', () => {
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { code: VALIDATION_FAILED }))).toBe(
      false,
    )
    expect(isDuplicateKeyError(new Error('no code'))).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
    expect(isDuplicateKeyError('E11000')).toBe(false)
  })

  it('tolerates a bulk error whose every failure is a duplicate', () => {
    expect(isDuplicateKeyError(bulkError(DUPLICATE, DUPLICATE, DUPLICATE, DUPLICATE))).toBe(true)
  })

  it('does not tolerate a bulk error that starts with a duplicate then has another failure', () => {
    expect(isDuplicateKeyError(bulkError(DUPLICATE, DUPLICATE, VALIDATION_FAILED))).toBe(false)
  })

  it('does not tolerate a bulk error that starts with another failure then has a duplicate', () => {
    expect(isDuplicateKeyError(bulkError(VALIDATION_FAILED, VALIDATION_FAILED, DUPLICATE))).toBe(
      false,
    )
  })

  it('ignores the top-level code of a bulk error', () => {
    expect(isDuplicateKeyError(bulkError(DUPLICATE, VALIDATION_FAILED))).toBe(false)
    expect(isDuplicateKeyError(bulkError(VALIDATION_FAILED, DUPLICATE))).toBe(true)
  })

  it('also reads a code that sits directly on the entry (driver-level write errors)', () => {
    const error = Object.assign(new Error('bulk'), {
      writeErrors: [{ code: DUPLICATE }, { code: DUPLICATE }],
    })
    expect(isDuplicateKeyError(error)).toBe(true)
    expect(
      isDuplicateKeyError(
        Object.assign(new Error('bulk'), { writeErrors: [{ code: DUPLICATE }, { code: 1 }] }),
      ),
    ).toBe(false)
  })

  it('does not tolerate a bulk error with no entries or an entry without a code', () => {
    expect(isDuplicateKeyError(bulkError(DUPLICATE))).toBe(false)
    expect(isDuplicateKeyError(Object.assign(new Error('bulk'), { writeErrors: [{}] }))).toBe(false)
  })
})
