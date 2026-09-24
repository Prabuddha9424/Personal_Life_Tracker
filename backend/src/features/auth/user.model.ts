import bcrypt from 'bcryptjs'
import { model, Schema, type HydratedDocument } from 'mongoose'
import { BCRYPT_COST } from './constants.ts'

interface UserAttrs {
  email: string
  /** Holds the bcrypt hash. Hashed by the pre-save hook, never selected by default. */
  password: string
  name: string
  currency: string
  emailVerifiedAt?: Date
}

export type UserDoc = HydratedDocument<UserAttrs>

const userSchema = new Schema<UserAttrs>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    emailVerifiedAt: { type: Date },
  },
  { timestamps: true },
)

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, BCRYPT_COST)
})

export const User = model<UserAttrs>('User', userSchema)
