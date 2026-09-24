import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import type { Types } from 'mongoose'
import { signAccessToken } from '../../shared/auth/token.ts'
import { env } from '../../shared/config/env.ts'
import { AppError } from '../../shared/errors/AppError.ts'
import { BCRYPT_COST, REFRESH_REUSE_GRACE_MS } from './constants.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { generateToken, hashToken } from './tokens.ts'
import { User } from './user.model.ts'

export interface Session {
  accessToken: string
  user: PublicUser
  refreshToken: string
  refreshExpiresAt: Date
}

const DAY_MS = 86_400_000

// Compared against when the email is unknown, so a miss costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST)

/** Issues an access token and a new refresh token, in an existing family or a new one. */
export async function startSession(
  user: { _id: Types.ObjectId; email: string; name: string; currency: string },
  familyId: string = randomBytes(16).toString('hex'),
): Promise<Session> {
  const { raw, hash } = generateToken()
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS)
  await RefreshToken.create({
    userId: user._id,
    familyId,
    tokenHash: hash,
    expiresAt: refreshExpiresAt,
  })
  return {
    accessToken: signAccessToken(user._id.toString()),
    user: toPublicUser(user),
    refreshToken: raw,
    refreshExpiresAt,
  }
}

export async function login(email: string, password: string): Promise<Session> {
  const user = await User.findOne({ email }).select('+password')
  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_HASH)
  if (!user || !passwordMatches) throw new AppError(401, 'Invalid email or password')
  if (!user.emailVerifiedAt) throw new AppError(403, 'Please verify your email before logging in')
  return startSession(user)
}

/**
 * Rotates a refresh token. A token can be used once: presenting an already-rotated token after the
 * grace period is treated as theft and revokes the whole family.
 */
export async function refreshSession(rawToken: string | undefined): Promise<Session> {
  if (!rawToken) throw new AppError(401, 'Not authorized')
  const tokenHash = hashToken(rawToken)

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { revokedAt: new Date() },
  )

  if (!claimed) {
    const known = await RefreshToken.findOne({ tokenHash })
    if (known?.revokedAt && Date.now() - known.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
      await RefreshToken.updateMany(
        { familyId: known.familyId, revokedAt: { $exists: false } },
        { revokedAt: new Date() },
      )
    }
    throw new AppError(401, 'Not authorized')
  }

  const user = await User.findById(claimed.userId)
  if (!user?.emailVerifiedAt) throw new AppError(401, 'Not authorized')
  return startSession(user, claimed.familyId)
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  )
}

export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { revokedAt: new Date() },
  )
}
