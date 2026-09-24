import { request } from '../../test/http.ts'
import { describe, expect, it } from 'vitest'
import { app } from '../../app.ts'

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', database: 'down' })
  })
})

describe('unknown routes', () => {
  it('returns 404 in the standard error format', async () => {
    const res = await request(app).get('/api/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'Route not found: GET /api/does-not-exist' })
  })
})
