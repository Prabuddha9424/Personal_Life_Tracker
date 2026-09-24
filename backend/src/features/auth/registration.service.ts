import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors/AppError.ts'
import { isDuplicateKeyError } from '../../shared/errors/isDuplicateKeyError.ts'
import { sendAlreadyRegisteredEmail, sendVerificationEmail } from './auth.emails.ts'
import type { RegisterInput } from './auth.schemas.ts'
import { BCRYPT_COST, VERIFY_TOKEN_TTL_MS } from './constants.ts'
import { consumeEmailToken, createEmailToken } from './email-tokens.ts'
import { User, type UserDoc } from './user.model.ts'

async function sendVerification(user: Pick<UserDoc, '_id' | 'email' | 'name'>): Promise<void> {
  const token = await createEmailToken(user._id, 'verify', VERIFY_TOKEN_TTL_MS)
  await sendVerificationEmail(user.email, user.name, token)
}

async function handleExistingAccount(user: UserDoc, input: RegisterInput): Promise<void> {
  // The same bcrypt work whichever branch runs, so response time does not reveal the account state.
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST)
  if (!user.emailVerifiedAt) {
    // An abandoned sign-up: the latest submission wins, so whoever verifies gets the password they
    // just chose and an earlier submission (for example an attacker pre-registering the address)
    // cannot keep its password on the account. The filter makes this atomic: if the owner verified
    // since the lookup, nothing is overwritten and this falls through to the verified branch.
    const overwritten = await User.updateOne(
      { _id: user._id, emailVerifiedAt: { $exists: false } },
      { password: passwordHash, name: input.name, currency: input.currency },
    )
    if (overwritten.matchedCount === 1) {
      await sendVerification({ _id: user._id, email: user.email, name: input.name })
      return
    }
  }
  await sendAlreadyRegisteredEmail(user.email, user.name)
}

/** Always resolves the same way whether or not the email is already registered. */
export async function register(input: RegisterInput): Promise<void> {
  const existing = await User.findOne({ email: input.email })
  if (existing) {
    await handleExistingAccount(existing, input)
    return
  }

  try {
    await sendVerification(await User.create(input))
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    // Two sign-ups raced. Treat the loser as a duplicate.
    const raced = await User.findOne({ email: input.email })
    if (raced) await handleExistingAccount(raced, input)
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
