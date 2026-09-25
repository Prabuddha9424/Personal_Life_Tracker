import { readCsv, type CsvRow } from './csv'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
])

export type ImportFileResult = { rows: CsvRow[] } | { error: string }

function looksLikeText(file: File): boolean {
  return /\.(csv|txt)$/i.test(file.name) || TEXT_TYPES.has(file.type)
}

/**
 * Reads a chosen file for the import dialog. Every refusal comes back as a message for the person
 * to read; nothing is thrown. The size is checked before the file is read, so a huge file is never
 * loaded, and text with NUL characters is refused as binary.
 */
export async function readImportFile(file: File): Promise<ImportFileResult> {
  if (!looksLikeText(file)) return { error: 'Choose a .csv or .txt file' }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error:
        'That file is larger than 5 MB. Split it into smaller files and import them one at a time.',
    }
  }

  let text: string
  try {
    text = await file.text()
  } catch {
    return { error: 'Could not read that file' }
  }
  if (text.includes('\u0000')) {
    return { error: 'That does not look like a text file. Export the data as CSV and try again.' }
  }

  const { rows } = readCsv(text)
  return rows.length === 0 ? { error: 'That file has no rows' } : { rows }
}
