import express from 'express'
import { request } from '../../test/http.ts'
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

  it('keeps an independent counter for each limiter instance', async () => {
    const app = express()
    app.get('/strict', createRateLimiter({ windowMs: 60_000, limit: 1 }), (_req, res) => {
      res.json({ ok: true })
    })
    app.get('/loose', createRateLimiter({ windowMs: 60_000, limit: 5 }), (_req, res) => {
      res.json({ ok: true })
    })

    await request(app).get('/strict').expect(200)
    await request(app).get('/strict').expect(429)
    await request(app).get('/loose').expect(200)
  })
})
