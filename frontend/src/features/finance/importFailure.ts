import axios from 'axios'
import { describeSaveError } from './saveError'

const MAX_DETAILS = 3
const ROW_MESSAGE = /^Row (\d+): (.*)$/s
const ROW_PATH = /^rows\.(\d+)(?:\.(.*))?$/

interface ErrorBody {
  message?: unknown
  errors?: unknown
}

export interface BatchFailure {
  /** The failure in words, naming file lines instead of positions within the batch. */
  message: string
  /** True when the server answered and turned the batch down, so none of it was saved. */
  rejected: boolean
}

function lineOf(lines: readonly number[], start: number, size: number, index: number) {
  return Number.isInteger(index) && index >= 0 && index < size ? lines[start + index] : undefined
}

const unplaced = (reason: string) => `Could not place this error on a line of the file: ${reason}`

/**
 * Explains why a batch of the import failed. The server counts the rows of a batch from 1 and
 * knows nothing of the file ("Row 3: unknown category"; a schema failure names `rows.2.date`
 * from 0), so those positions are turned back into file lines: for a batch that starts at valid
 * index `start` and holds `size` rows, "Row N" is `lines[start + N - 1]`. A position outside the
 * batch is never turned into a line, since it would name a row of a neighbouring batch.
 */
export function describeBatchFailure(
  error: unknown,
  lines: readonly number[],
  start: number,
  size: number,
): BatchFailure {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  const rejected = status !== undefined && status >= 400 && status < 500
  const body: ErrorBody | undefined = axios.isAxiosError<ErrorBody>(error)
    ? error.response?.data
    : undefined

  const rowMatch = typeof body?.message === 'string' ? ROW_MESSAGE.exec(body.message) : null
  if (rowMatch) {
    const reason = rowMatch[2] ?? ''
    const line = lineOf(lines, start, size, Number(rowMatch[1]) - 1)
    return { message: line === undefined ? unplaced(reason) : `Line ${line}: ${reason}`, rejected }
  }

  if (Array.isArray(body?.errors)) {
    const details = body.errors.flatMap((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null) return []
      const { path, message } = issue as { path?: unknown; message?: unknown }
      if (typeof path !== 'string' || typeof message !== 'string') return []
      const match = ROW_PATH.exec(path)
      const line = match ? lineOf(lines, start, size, Number(match[1])) : undefined
      if (line === undefined) return []
      return [`Line ${line}: ${match?.[2] ? `${match[2]}: ` : ''}${message}`]
    })
    if (details.length > 0) return { message: details.slice(0, MAX_DETAILS).join('; '), rejected }
    if (body.errors.length > 0) return { message: unplaced(describeSaveError(error)), rejected }
  }

  return { message: describeSaveError(error), rejected }
}
