import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { describeBatchFailure } from './importFailure'

function apiError(status: number, data: unknown) {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  })
}

// Valid row i of the batch that starts at index 2 sits on these file lines.
const lines = [3, 4, 7, 9, 12, 13, 20]

describe('describeBatchFailure', () => {
  it('maps "Row N" (1-based within the batch) back to the file line', () => {
    const failure = describeBatchFailure(
      apiError(400, { message: 'Row 3: unknown category' }),
      lines,
      2,
    )

    // offset 2 + N 3 - 1 = index 4
    expect(failure).toEqual({ message: 'Line 12: unknown category', rejected: true })
  })

  it('maps the first row of a batch', () => {
    const failure = describeBatchFailure(
      apiError(400, { message: 'Row 1: that is an income category' }),
      lines,
      0,
    )

    expect(failure.message).toBe('Line 3: that is an income category')
  })

  it('maps schema failures, whose paths count rows from 0', () => {
    const failure = describeBatchFailure(
      apiError(400, {
        message: 'Validation failed',
        errors: [
          { path: 'rows.1.amountMinor', message: 'Too big' },
          { path: 'rows.0.date', message: 'Invalid' },
        ],
      }),
      lines,
      2,
    )

    expect(failure).toEqual({
      message: 'Line 9: amountMinor: Too big; Line 7: date: Invalid',
      rejected: true,
    })
  })

  it('never names a wrong line for a row number it cannot place', () => {
    const failure = describeBatchFailure(
      apiError(400, { message: 'Row 99: unknown category' }),
      lines,
      2,
    )

    expect(failure.message).toBe('A row of this batch was rejected: unknown category')
    expect(failure.message).not.toMatch(/Row 99|Line \d/)
  })

  it('keeps other rejections as they are', () => {
    const failure = describeBatchFailure(
      apiError(400, { message: 'Request body too large' }),
      lines,
      0,
    )

    expect(failure).toEqual({ message: 'Request body too large', rejected: true })
  })

  it('does not treat a lost connection or a server error as a definite rejection', () => {
    expect(describeBatchFailure(new Error('Network Error'), lines, 0)).toEqual({
      message: 'Network Error',
      rejected: false,
    })
    expect(
      describeBatchFailure(apiError(500, { message: 'Internal error' }), lines, 0).rejected,
    ).toBe(false)
  })
})
