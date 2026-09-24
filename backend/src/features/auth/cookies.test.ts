import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCookies } from './cookies.ts'

describe('parseCookies', () => {
  it('parses several cookies', () => {
    expect(parseCookies('a=1; b=two; c=3')).toEqual({ a: '1', b: 'two', c: '3' })
  })

  it('keeps an equals sign inside a value', () => {
    expect(parseCookies('token=abc=def')).toEqual({ token: 'abc=def' })
  })

  it('decodes percent-encoding and survives malformed encoding', () => {
    expect(parseCookies('a=hello%20world; b=%E0%A4%A')).toEqual({
      a: 'hello world',
      b: '%E0%A4%A',
    })
  })

  it('keeps the first occurrence of a repeated name', () => {
    expect(parseCookies('refresh_token=specific; other=1; refresh_token=general')).toEqual({
      refresh_token: 'specific',
      other: '1',
    })
  })

  it('ignores empty input, empty names and parts without a value', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies('=x; junk; ok=1')).toEqual({ ok: '1' })
  })
})

describe('refresh cookie flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function cookieHeaders(nodeEnv: string) {
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.resetModules()
    const { setRefreshCookie, clearRefreshCookie, readRefreshCookie } = await import('./cookies.ts')
    const app = express()
    app.get('/set', (_req, res) => {
      setRefreshCookie(res, 'abc', new Date('2030-01-01T00:00:00Z'))
      res.end()
    })
    app.get('/clear', (_req, res) => {
      clearRefreshCookie(res)
      res.end()
    })
    app.get('/read', (req, res) => {
      res.json({ token: readRefreshCookie(req) ?? null })
    })
    const headerOf = async (path: string) =>
      (
        (await request(app).get(path)).headers['set-cookie'] as unknown as string[] | undefined
      )?.[0] ?? ''
    return { set: await headerOf('/set'), clear: await headerOf('/clear'), app }
  }

  it('is not Secure outside production', async () => {
    const { set, clear } = await cookieHeaders('test')

    for (const header of [set, clear]) {
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Path=/api/auth')
      expect(header).toContain('SameSite=Lax')
      expect(header).not.toContain('Secure')
    }
  })

  it('is Secure in production, and clearing uses the same flags', async () => {
    const { set, clear } = await cookieHeaders('production')

    expect(set).toContain('refresh_token=abc')
    expect(set).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT')
    for (const header of [set, clear]) {
      expect(header).toContain('HttpOnly')
      expect(header).toContain('Path=/api/auth')
      expect(header).toContain('SameSite=Lax')
      expect(header).toContain('Secure')
    }
    expect(clear).toContain('refresh_token=;')
    expect(clear).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })

  it('reads the refresh cookie from the request', async () => {
    const { app } = await cookieHeaders('test')

    const res = await request(app).get('/read').set('Cookie', 'x=1; refresh_token=tok')

    expect(res.body).toEqual({ token: 'tok' })
  })
})
