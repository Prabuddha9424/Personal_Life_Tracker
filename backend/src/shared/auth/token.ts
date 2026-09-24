import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.ts'

export interface AccessTokenPayload {
  sub: string
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  })
}

/** Returns the payload, or null if the token is invalid or expired. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    return typeof payload === 'object' && typeof payload.sub === 'string'
      ? { sub: payload.sub }
      : null
  } catch {
    return null
  }
}
