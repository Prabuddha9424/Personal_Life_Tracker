import { model, Schema, type Types } from 'mongoose'

export type EmailTokenPurpose = 'verify' | 'reset'

interface EmailTokenAttrs {
  userId: Types.ObjectId
  purpose: EmailTokenPurpose
  /** SHA-256 of the raw token. The raw token exists only in the email. */
  tokenHash: string
  expiresAt: Date
  usedAt?: Date
}

const emailTokenSchema = new Schema<EmailTokenAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['verify', 'reset'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
})

// MongoDB removes expired tokens in the background.
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const EmailToken = model<EmailTokenAttrs>('EmailToken', emailTokenSchema)
