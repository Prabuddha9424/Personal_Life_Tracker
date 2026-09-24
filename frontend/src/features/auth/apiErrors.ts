import axios from 'axios'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

interface ApiFieldError {
  path: string
  message: string
}

function isFieldError(value: unknown): value is ApiFieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

/** The per-field reasons from a 400 `{ message, errors: [{ path, message }] }` response, else []. */
export function getFieldErrors(error: unknown): ApiFieldError[] {
  if (!axios.isAxiosError<{ errors?: unknown }>(error) || error.response?.status !== 400) return []
  const errors = error.response.data?.errors
  return Array.isArray(errors) ? errors.filter(isFieldError) : []
}

/** Whether the response explains itself through one of the given form fields. */
export function hasFieldErrorFor(error: unknown, fields: readonly string[]): boolean {
  return getFieldErrors(error).some((fieldError) => fields.includes(fieldError.path))
}

/** Shows each server-side field error next to its form field; paths that match no field are skipped. */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  for (const fieldError of getFieldErrors(error)) {
    const field = fields.find((name) => name === fieldError.path)
    if (field) setError(field, { type: 'server', message: fieldError.message })
  }
}
