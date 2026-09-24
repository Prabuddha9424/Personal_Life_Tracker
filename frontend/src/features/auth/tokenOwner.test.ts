import { describe, expect, it } from 'vitest'
import { tokenOwnerId } from './tokenOwner'

const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const bearer = (payload: unknown) => `Bearer ${encode({ alg: 'HS256' })}.${encode(payload)}.sig`

describe('tokenOwnerId', () => {
  it('reads the subject of a bearer token', () => {
    expect(tokenOwnerId(bearer({ sub: 'user-1', iat: 1 }))).toBe('user-1')
  })

  it('handles url-safe base64 payloads that need padding', () => {
    expect(tokenOwnerId(bearer({ sub: '?>?>?>' }))).toBe('?>?>?>')
  })

  it.each([
    ['not a bearer header', 'Basic abc'],
    ['no dots', 'Bearer nonsense'],
    ['a payload that is not base64', 'Bearer a.%%%.c'],
    ['a payload that is not JSON', `Bearer a.${btoa('not json')}.c`],
    ['a payload without a subject', bearer({ iat: 1 })],
    ['an empty subject', bearer({ sub: '' })],
    ['a numeric subject', bearer({ sub: 5 })],
    ['a payload that is not an object', bearer('text')],
    ['an empty header', ''],
  ])('returns null for %s', (_name, header) => {
    expect(tokenOwnerId(header)).toBeNull()
  })
})
