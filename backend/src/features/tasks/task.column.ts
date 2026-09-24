import type { Types } from 'mongoose'
import { Task, type TaskStatus } from './task.model.ts'
import { POSITION_STEP } from './task.ordering.ts'

/** Board order: by position, and for equal positions the newest card first (as new cards go on top). */
export const BOARD_ORDER = { position: 1, _id: -1 } as const

/** Renumbers a column 0, 1024, 2048, ... keeping its current board order. */
export async function rebalanceColumn(owner: Types.ObjectId, status: TaskStatus): Promise<void> {
  const cards = await Task.find({ userId: owner, status })
    .sort(BOARD_ORDER)
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>()
  if (cards.length === 0) return
  await Task.bulkWrite(
    cards.map((card, index) => ({
      updateOne: {
        filter: { _id: card._id, userId: owner, status },
        update: { $set: { position: index * POSITION_STEP } },
      },
    })),
  )
}
