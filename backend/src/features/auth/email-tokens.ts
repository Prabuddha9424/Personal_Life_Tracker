import type { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { EmailToken, type EmailTokenPurpose } from './email-token.model.ts'
import { generateToken, hashToken } from './tokens.ts'

/** Replaces any earlier token of the same purpose and returns the raw token to email. */
export async function createEmailToken(
  userId: Types.ObjectId,
  purpose: EmailTokenPurpose,
  ttlMs: number,
): Promise<string> {
  await EmailToken.deleteMany({ userId, purpose })
  const { raw, hash } = generateToken()
  await EmailToken.create({
    userId,
    purpose,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + ttlMs),
  })
  return raw
}

/** Atomically marks a valid, unused, unexpired token as used and returns its owner. */
export async function consumeEmailToken(
  raw: string,
  purpose: EmailTokenPurpose,
): Promise<Types.ObjectId> {
  const token = await EmailToken.findOneAndUpdate(
    {
      tokenHash: hashToken(raw),
      purpose,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    },
    { usedAt: new Date() },
  )
  if (!token) throw new AppError(400, 'Invalid or expired token')
  return token.userId
}
