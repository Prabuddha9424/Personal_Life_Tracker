import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimiters.ts'

describe('createRateLimiter', () => {
  it('answers 429 in the standard error format once the limit is exceeded', async () => {
    const app = express()
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }))
    app.get('/', (_req, res) => {
      res.json({ ok: true })
    })

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    const res = await request(app).get('/')

    expect(res.status).toBe(429)
    expect(res.body).toEqual({ message: 'Too many requests, please try again later' })
  })
})
