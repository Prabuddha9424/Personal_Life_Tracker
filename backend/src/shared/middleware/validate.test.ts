import express from 'express'
import { request } from '../../test/http.ts'
import { describe, expect, it } from 'vitest'
import { idParamsSchema, paginationQuerySchema } from '../validation/requestSchemas.ts'
import { errorHandler } from './errorHandler.ts'
import { validate } from './validate.ts'

function buildApp() {
  const app = express()
  app.get(
    '/items/:id',
    validate({ query: paginationQuerySchema, params: idParamsSchema }),
    (req, res) => {
      res.json({ query: req.query, params: req.params })
    },
  )
  app.use(errorHandler)
  return app
}

const validId = '65f1c2a4b3d4e5f6a7b8c9d0'

describe('validate with the shared request schemas', () => {
  it('rejects page=0 with a 400 that names the page path', async () => {
    const res = await request(buildApp()).get(`/items/${validId}?page=0`)

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Validation failed')
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'page' })]),
    )
  })

  it('rejects limit=201 with a 400', async () => {
    const res = await request(buildApp()).get(`/items/${validId}?limit=201`)

    expect(res.status).toBe(400)
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'limit' })]),
    )
  })

  it('rejects a malformed id with a 400', async () => {
    const res = await request(buildApp()).get('/items/not-an-id')

    expect(res.status).toBe(400)
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'id' })]),
    )
  })

  it('passes parsed numbers to the handler', async () => {
    const res = await request(buildApp()).get(`/items/${validId}?page=2&limit=10`)

    expect(res.status).toBe(200)
    expect(res.body.query).toEqual({ page: 2, limit: 10 })
    expect(res.body.params).toEqual({ id: validId })
  })
})
