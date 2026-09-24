import type { Types } from 'mongoose'

export interface PublicUser {
  id: string
  email: string
  name: string
  currency: string
}

export function toPublicUser(user: {
  _id: Types.ObjectId
  email: string
  name: string
  currency: string
}): PublicUser {
  return { id: user._id.toString(), email: user.email, name: user.name, currency: user.currency }
}
