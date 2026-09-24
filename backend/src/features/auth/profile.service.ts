import { AppError } from '../../shared/errors/AppError.ts'
import { toPublicUser, type PublicUser } from './public-user.ts'
import { User } from './user.model.ts'

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId).lean()
  if (!user) throw new AppError(401, 'Not authorized')
  return toPublicUser(user)
}

export async function updateProfile(userId: string, input: { name: string }): Promise<PublicUser> {
  const user = await User.findByIdAndUpdate(
    userId,
    { name: input.name },
    { returnDocument: 'after' },
  ).lean()
  if (!user) throw new AppError(401, 'Not authorized')
  return toPublicUser(user)
}
