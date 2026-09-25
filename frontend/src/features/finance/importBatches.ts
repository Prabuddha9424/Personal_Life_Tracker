import type { TransactionInput } from './types'

/** The API reads at most 500 rows per request. */
const MAX_BATCH_ROWS = 200
/**
 * The API rejects a body over 100 KB (`express.json({ limit: '100kb' })`) with a 413 that no
 * retry can cure. Rows are cut by encoded size to stay well under it: 200 notes of 200 characters
 * are about 61 KB in ASCII but about 139 KB in Sinhala, and a note of quotes doubles in size.
 */
const MAX_BATCH_BYTES = 90 * 1024
/** The bytes of `{"rows":[` and `]}` around the rows, and of the comma between two of them. */
const ENVELOPE_BYTES = 11
const SEPARATOR_BYTES = 1

export interface PlannedBatch {
  rows: TransactionInput[]
  /** Index in the list of valid rows of the batch's first row, for turning "Row N" into a file line. */
  start: number
}

const encoder = new TextEncoder()

/**
 * Cuts rows into the batches to send, in order, each holding at most 200 rows and at most 90 KB
 * of JSON. Each row is encoded once, so the work is linear in the input. A batch always holds at
 * least one row: a single row is far below the cap (a note is at most 200 characters).
 */
export function planBatches(rows: readonly TransactionInput[]): PlannedBatch[] {
  const batches: PlannedBatch[] = []
  let current: TransactionInput[] = []
  let start = 0
  let bytes = ENVELOPE_BYTES

  for (const [index, row] of rows.entries()) {
    const size = encoder.encode(JSON.stringify(row)).length
    const added = size + (current.length > 0 ? SEPARATOR_BYTES : 0)
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_ROWS || bytes + added > MAX_BATCH_BYTES)
    ) {
      batches.push({ rows: current, start })
      current = []
      start = index
      bytes = ENVELOPE_BYTES
    }
    bytes += size + (current.length > 0 ? SEPARATOR_BYTES : 0)
    current.push(row)
  }
  if (current.length > 0) batches.push({ rows: current, start })
  return batches
}
