import { describe, expect, it } from 'vitest'
import { redirectTarget } from './redirectTarget'

describe('redirectTarget', () => {
  it('keeps a local path with its query string and hash', () => {
    expect(redirectTarget({ from: '/board?filter=done#top' })).toBe('/board?filter=done#top')
  })

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example'],
    ['a slash-backslash prefix, which browsers read as //host', '/\\evil.example'],
    ['a relative path', 'board'],
    ['a non-string', 42],
  ])('falls back to the home page for %s', (_label, from) => {
    expect(redirectTarget({ from })).toBe('/')
  })

  it.each([[null], [undefined], ['/board'], [{}]])(
    'falls back to / when the state is %j',
    (state) => {
      expect(redirectTarget(state)).toBe('/')
    },
  )
})
