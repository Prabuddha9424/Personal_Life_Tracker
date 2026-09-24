import bcrypt from 'bcryptjs'
import { currencySchema } from './auth.schemas.ts'
import { EmailToken } from './email-token.model.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { RefreshToken } from './refresh-token.model.ts'
import { User } from './user.model.ts'

export type UserProfile = PublicUser

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const user = await User.findById(userId).lean()
  return user ? toPublicUser(user) : null
}

export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const user = await User.findById(userId).select('+password')
  return user ? bcrypt.compare(password, user.password) : false
}

export async function setUserCurrency(userId: string, currency: string): Promise<void> {
  await User.updateOne({ _id: userId }, { currency: currencySchema.parse(currency) })
}

/** Removes the account and everything the auth slice stores about it. */
export async function deleteUser(userId: string): Promise<void> {
  await Promise.all([RefreshToken.deleteMany({ userId }), EmailToken.deleteMany({ userId })])
  await User.deleteOne({ _id: userId })
}
