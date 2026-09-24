import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { env } from '../config/env.ts'
import { errorHandler } from './errorHandler.ts'
import { requireCronSecret } from './requireCronSecret.ts'

function buildApp() {
  const app = express()
  app.post('/run', requireCronSecret, (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorHandler)
  return app
}

describe('requireCronSecret', () => {
  it('accepts the configured secret', async () => {
    const res = await request(buildApp()).post('/run').set('x-cron-secret', env.CRON_SECRET)

    expect(res.status).toBe(200)
  })

  it.each([
    ['a missing header', undefined],
    ['a wrong secret of the same length', 'x'.repeat(env.CRON_SECRET.length)],
    ['a secret of a different length', 'short'],
    ['an empty secret', ''],
  ])('rejects %s with 401', async (_name, value) => {
    const req = request(buildApp()).post('/run')
    const res = await (value === undefined ? req : req.set('x-cron-secret', value))

    expect(res.status).toBe(401)
    expect(res.body).toEqual({ message: 'Not authorized' })
  })
})
