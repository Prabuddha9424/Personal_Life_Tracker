import { model, Schema, type Types } from 'mongoose'
import { CATEGORY_KINDS, type CategoryKind } from './category.model.ts'

export const MAX_AMOUNT_MINOR = 1_000_000_000_000

export interface TransactionAttrs {
  userId: Types.ObjectId
  kind: CategoryKind
  /** Positive integer in the currency's minor unit (cents). The kind carries the sign. */
  amountMinor: number
  /** ISO 4217 code, copied from the user's profile when the transaction is created. */
  currency: string
  categoryId: Types.ObjectId
  /** UTC midnight of the calendar day. */
  date: Date
  note: string
}

export type TransactionRecord = TransactionAttrs & { _id: Types.ObjectId }

const transactionSchema = new Schema<TransactionAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: CATEGORY_KINDS, required: true },
  amountMinor: {
    type: Number,
    required: true,
    min: 1,
    max: MAX_AMOUNT_MINOR,
    validate: { validator: Number.isInteger, message: 'amountMinor must be an integer' },
  },
  currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  date: { type: Date, required: true },
  note: { type: String, default: '', maxlength: 200 },
})

transactionSchema.index({ userId: 1, date: -1 })
transactionSchema.index({ userId: 1, categoryId: 1 })
transactionSchema.index({ userId: 1, kind: 1, date: -1 })

export const Transaction = model<TransactionAttrs>('Transaction', transactionSchema)
