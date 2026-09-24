import { Types } from 'mongoose'
import { signAccessToken } from '../shared/auth/token.ts'

/**
 * A fake tenant. `requireAuth` only verifies the JWT, so tenant-slice tests do not
 * need a real user row: a random ObjectId with a signed token is enough.
 */
export function testUser(): { id: string; headers: { Authorization: string } } {
  const id = new Types.ObjectId().toString()
  return { id, headers: { Authorization: `Bearer ${signAccessToken(id)}` } }
}
