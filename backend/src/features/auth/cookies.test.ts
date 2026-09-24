import { describe, expect, it } from 'vitest'
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

  it('ignores empty input, empty names and parts without a value', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies('=x; junk; ok=1')).toEqual({ ok: '1' })
  })
})
