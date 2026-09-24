import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/AppError.ts'
import { sendAlreadyRegisteredEmail, sendVerificationEmail } from './auth.emails.ts'
import type { RegisterInput } from './auth.schemas.ts'
import { BCRYPT_COST, VERIFY_TOKEN_TTL_MS } from './constants.ts'
import { consumeEmailToken, createEmailToken } from './email-tokens.ts'
import { User, type UserDoc } from './user.model.ts'

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 11000
}

async function sendVerification(user: UserDoc): Promise<void> {
  const token = await createEmailToken(user._id, 'verify', VERIFY_TOKEN_TTL_MS)
  await sendVerificationEmail(user.email, user.name, token)
}

async function handleExistingAccount(user: UserDoc, submittedPassword: string): Promise<void> {
  // Same bcrypt work as creating an account, so response time does not reveal that it exists.
  await bcrypt.hash(submittedPassword, BCRYPT_COST)
  if (user.emailVerifiedAt) {
    await sendAlreadyRegisteredEmail(user.email, user.name)
  } else {
    await sendVerification(user)
  }
}

/** Always resolves the same way whether or not the email is already registered. */
export async function register(input: RegisterInput): Promise<void> {
  const existing = await User.findOne({ email: input.email })
  if (existing) {
    await handleExistingAccount(existing, input.password)
    return
  }

  try {
    await sendVerification(await User.create(input))
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    // Two sign-ups raced. Treat the loser as a duplicate.
    const raced = await User.findOne({ email: input.email })
    if (raced) await handleExistingAccount(raced, input.password)
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeEmailToken(token, 'verify')
  const result = await User.updateOne({ _id: userId }, { emailVerifiedAt: new Date() })
  if (result.matchedCount === 0) throw new AppError(400, 'Invalid or expired token')
}

export async function resendVerification(email: string): Promise<void> {
  const user = await User.findOne({ email, emailVerifiedAt: { $exists: false } })
  if (user) await sendVerification(user)
}
