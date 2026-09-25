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

/**
 * Explains why a batch of the import failed. The server counts the rows of a batch from 1 and
 * knows nothing of the file ("Row 3: unknown category"; a schema failure names `rows.2.date`
 * from 0), so those positions are turned back into file lines: for a batch that starts at valid
 * index `offset`, "Row N" is `lines[offset + N - 1]`. A position that does not exist is never
 * shown as a line.
 */
export function describeBatchFailure(
  error: unknown,
  lines: readonly number[],
  offset: number,
): BatchFailure {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined
  const rejected = status !== undefined && status >= 400 && status < 500
  const body: ErrorBody | undefined = axios.isAxiosError<ErrorBody>(error)
    ? error.response?.data
    : undefined

  const rowMatch = typeof body?.message === 'string' ? ROW_MESSAGE.exec(body.message) : null
  if (rowMatch) {
    const line = lines[offset + Number(rowMatch[1]) - 1]
    const reason = rowMatch[2] ?? ''
    return {
      message:
        line === undefined
          ? `A row of this batch was rejected: ${reason}`
          : `Line ${line}: ${reason}`,
      rejected,
    }
  }

  if (Array.isArray(body?.errors)) {
    const details = body.errors.flatMap((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null) return []
      const { path, message } = issue as { path?: unknown; message?: unknown }
      if (typeof path !== 'string' || typeof message !== 'string') return []
      const match = ROW_PATH.exec(path)
      const line = match ? lines[offset + Number(match[1])] : undefined
      if (line === undefined) return []
      return [`Line ${line}: ${match?.[2] ? `${match[2]}: ` : ''}${message}`]
    })
    if (details.length > 0) return { message: details.slice(0, MAX_DETAILS).join('; '), rejected }
  }

  return { message: describeSaveError(error), rejected }
}
