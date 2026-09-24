import { createHash, randomBytes } from 'node:crypto'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** A random URL-safe token to email or set as a cookie, and the hash that is stored. */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex')
  return { raw, hash: hashToken(raw) }
}
