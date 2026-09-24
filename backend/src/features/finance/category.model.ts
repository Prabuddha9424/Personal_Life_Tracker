import { model, Schema, type Types } from 'mongoose'

export const CATEGORY_KINDS = ['income', 'expense'] as const
export type CategoryKind = (typeof CATEGORY_KINDS)[number]

export interface CategoryAttrs {
  userId: Types.ObjectId
  name: string
  kind: CategoryKind
}

export type CategoryRecord = CategoryAttrs & { _id: Types.ObjectId }

const categorySchema = new Schema<CategoryAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  kind: { type: String, enum: CATEGORY_KINDS, required: true },
})

// Names are unique per user and kind, ignoring case ("Food" and "food" are the same category).
categorySchema.index(
  { userId: 1, kind: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
)

export const Category = model<CategoryAttrs>('Category', categorySchema)
