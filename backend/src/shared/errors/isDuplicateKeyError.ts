const DUPLICATE_KEY = 11000

const hasCode = (value: unknown): value is { code: unknown } =>
  typeof value === 'object' && value !== null && 'code' in value

/** A bulk write failure's code: on the entry itself, or on the driver error Mongoose wraps as `err`. */
function entryCode(entry: unknown): unknown {
  if (hasCode(entry)) return entry.code
  if (typeof entry === 'object' && entry !== null && 'err' in entry && hasCode(entry.err)) {
    return entry.err.code
  }
  return undefined
}

/**
 * True for a single duplicate-key error, or for a bulk write error in which EVERY failed entry is a
 * duplicate. A bulk error's own `code` is only that of its first failure, so it is ignored: a mix of
 * duplicates and other failures (validation, ...) is not tolerable and must propagate.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if ('writeErrors' in err) {
    const entries: unknown = err.writeErrors
    const list = Array.isArray(entries) ? entries : [entries]
    return list.length > 0 && list.every((entry) => entryCode(entry) === DUPLICATE_KEY)
  }
  return hasCode(err) && err.code === DUPLICATE_KEY
}
