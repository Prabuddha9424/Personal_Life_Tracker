import axios from 'axios'
import { getErrorMessage } from '@/shared/api/httpClient'

const MAX_DETAILS = 3

interface ValidationBody {
  errors?: unknown
}

/** The API's message, followed by the field messages it lists for a 400, so a rejected save says why. */
export function describeSaveError(error: unknown): string {
  const message = getErrorMessage(error)
  if (!axios.isAxiosError<ValidationBody>(error)) return message

  const issues = error.response?.data?.errors
  if (!Array.isArray(issues)) return message

  const details = issues
    .flatMap((issue: unknown) => {
      if (typeof issue !== 'object' || issue === null) return []
      const { path, message: text } = issue as { path?: unknown; message?: unknown }
      if (typeof text !== 'string' || text === '') return []
      return [typeof path === 'string' && path !== '' ? `${path}: ${text}` : text]
    })
    .slice(0, MAX_DETAILS)

  return details.length > 0 ? `${message}: ${details.join('; ')}` : message
}
