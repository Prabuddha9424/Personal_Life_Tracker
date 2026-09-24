import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/AppError.ts'
import { sendPasswordResetEmail } from './auth.emails.ts'
import { RESET_TOKEN_TTL_MS } from './constants.ts'
import { consumeEmailToken, createEmailToken } from './email-tokens.ts'
import { revokeAllSessions, startSession, type Session } from './session.service.ts'
import { User } from './user.model.ts'

/** Only verified accounts get a link. Resolves the same way for every email. */
export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerifiedAt: { $exists: true } })
  if (!user) return
  const token = await createEmailToken(user._id, 'reset', RESET_TOKEN_TTL_MS)
  await sendPasswordResetEmail(user.email, user.name, token)
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const userId = await consumeEmailToken(token, 'reset')
  const user = await User.findById(userId).select('+password')
  if (!user) throw new AppError(400, 'Invalid or expired token')
  // Load and save (not update): the pre-save hook is what hashes the password.
  user.password = password
  await user.save()
  await revokeAllSessions(user._id)
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  const user = await User.findById(userId).select('+password')
  if (!user) throw new AppError(401, 'Not authorized')
  // 403, not 401: the client treats 401 as "session expired" and would log the user out.
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new AppError(403, 'Current password is incorrect')
  }
  user.password = newPassword
  await user.save()
  await revokeAllSessions(user._id)
  return startSession(user)
}
