import { model, Schema, type Types } from 'mongoose'

interface CategorySeedAttrs {
  userId: Types.ObjectId
}

/**
 * Written once a user's default categories are complete. It is the "already seeded" signal, so a
 * request that finds it can rely on the full set being there, and defaults a user deleted are not
 * created again.
 */
const categorySeedSchema = new Schema<CategorySeedAttrs>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
})

export const CategorySeed = model<CategorySeedAttrs>('CategorySeed', categorySeedSchema)
