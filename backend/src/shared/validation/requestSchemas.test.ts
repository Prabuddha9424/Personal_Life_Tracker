import { describe, expect, it } from 'vitest'
import {
  calendarDateSchema,
  idParamsSchema,
  monthSchema,
  objectIdSchema,
  paginated,
  paginationQuerySchema,
  toSkip,
} from './requestSchemas.ts'

describe('objectIdSchema', () => {
  it('accepts 24 hex characters', () => {
    expect(objectIdSchema.safeParse('65f1c2a4b3d4e5f6a7b8c9d0').success).toBe(true)
  })

  it.each(['', 'abc', '65f1c2a4b3d4e5f6a7b8c9d', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'rejects %j',
    (value) => {
      expect(objectIdSchema.safeParse(value).success).toBe(false)
    },
  )

  it('is usable as route params', () => {
    expect(idParamsSchema.parse({ id: '65f1c2a4b3d4e5f6a7b8c9d0' })).toEqual({
      id: '65f1c2a4b3d4e5f6a7b8c9d0',
    })
  })
})

describe('paginationQuerySchema', () => {
  it('defaults to page 1 and limit 50', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 50 })
  })

  it('coerces query strings', () => {
    expect(paginationQuerySchema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 })
  })

  it.each([{ page: '0' }, { page: '-1' }, { limit: '0' }, { limit: '201' }, { page: '1.5' }])(
    'rejects %j',
    (query) => {
      expect(paginationQuerySchema.safeParse(query).success).toBe(false)
    },
  )

  it('computes skip and the response shape', () => {
    expect(toSkip({ page: 3, limit: 20 })).toBe(40)
    expect(paginated(['a'], 41, { page: 3, limit: 20 })).toEqual({
      items: ['a'],
      page: 3,
      limit: 20,
      total: 41,
    })
  })
})

describe('calendarDateSchema', () => {
  it.each(['2026-02-28', '2028-02-29', '2026-12-31'])('accepts %s', (value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(true)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-2-3', '26-02-03', '2026-02-28T00:00:00Z', ''])(
    'rejects %j',
    (value) => {
      expect(calendarDateSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('monthSchema', () => {
  it('accepts YYYY-MM only', () => {
    expect(monthSchema.safeParse('2026-09').success).toBe(true)
    expect(monthSchema.safeParse('2026-13').success).toBe(false)
    expect(monthSchema.safeParse('2026-9').success).toBe(false)
    expect(monthSchema.safeParse('2026-09-01').success).toBe(false)
  })
})
