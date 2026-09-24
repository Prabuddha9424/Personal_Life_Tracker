import { model, Schema, type Types } from 'mongoose'

interface RefreshTokenAttrs {
  userId: Types.ObjectId
  /** All tokens descended from one login share a family, so theft can revoke them together. */
  familyId: string
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
}

const refreshTokenSchema = new Schema<RefreshTokenAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
})

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema)
