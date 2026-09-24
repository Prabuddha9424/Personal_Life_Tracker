import { Types } from 'mongoose'
import { AppError } from '../../shared/errors/AppError.ts'
import { rebalanceColumn } from './task.column.ts'
import { toTaskDto, type TaskDto } from './task.dto.ts'
import { Task, type TaskRecord, type TaskStatus } from './task.model.ts'
import { positionBetween } from './task.ordering.ts'
import type { MoveTaskInput } from './task.schemas.ts'

const STALE_BOARD = 'The board changed. Refresh and try again.'

interface Neighbour {
  id: string
  position: number
}

/** Whether `first` sits above `second` on the board: lower position, or newer when tied. */
const sitsAbove = (first: Neighbour, second: Neighbour) =>
  first.position < second.position || (first.position === second.position && first.id > second.id)

/**
 * The neighbour card, or undefined when none was given. A neighbour that is missing, belongs to
 * someone else, or is in another column means the client's view of the board is stale.
 */
async function findNeighbour(
  owner: Types.ObjectId,
  neighbourId: string | undefined,
  status: TaskStatus,
  movedId: string,
): Promise<Neighbour | undefined> {
  if (neighbourId === undefined) return undefined
  if (new Types.ObjectId(neighbourId).equals(movedId))
    throw new AppError(400, 'A card cannot be next to itself')
  const neighbour = await Task.findOne({ _id: neighbourId, userId: owner, status })
    .select('position')
    .lean<{ _id: Types.ObjectId; position: number } | null>()
  if (!neighbour) throw new AppError(409, STALE_BOARD)
  return { id: neighbour._id.toString(), position: neighbour.position }
}

async function positionFor(
  owner: Types.ObjectId,
  id: string,
  input: MoveTaskInput,
): Promise<number | null> {
  const [above, below] = await Promise.all([
    findNeighbour(owner, input.afterId, input.status, id),
    findNeighbour(owner, input.beforeId, input.status, id),
  ])
  if (above && below && !sitsAbove(above, below)) throw new AppError(409, STALE_BOARD)
  return positionBetween(above?.position, below?.position)
}

export async function moveTask(userId: string, id: string, input: MoveTaskInput): Promise<TaskDto> {
  const owner = new Types.ObjectId(userId)
  if (!(await Task.exists({ _id: id, userId: owner }))) throw new AppError(404, 'Task not found')

  let position = await positionFor(owner, id, input)
  if (position === null) {
    await rebalanceColumn(owner, input.status)
    position = await positionFor(owner, id, input)
  }
  if (position === null) throw new AppError(409, STALE_BOARD)

  const moved = await Task.findOneAndUpdate(
    { _id: id, userId: owner },
    { $set: { status: input.status, position } },
    { returnDocument: 'after' },
  ).lean<TaskRecord | null>()
  if (!moved) throw new AppError(404, 'Task not found')
  return toTaskDto(moved)
}
