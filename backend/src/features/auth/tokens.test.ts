import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from './tokens.ts'

describe('tokens', () => {
  it('generates a 64-character hex token and its SHA-256 hash', () => {
    const { raw, hash } = generateToken()

    expect(raw).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(hashToken(raw))
    expect(hash).not.toBe(raw)
  })

  it('generates a different token every time', () => {
    expect(generateToken().raw).not.toBe(generateToken().raw)
  })

  it('hashes with SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
