import { readCsv, type CsvRow } from './csv'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
])

type ImportFileResult = { rows: CsvRow[]; warning?: string } | { error: string }

const UTF16_MESSAGE =
  'This looks like a UTF-16 (Excel "Unicode Text") file \u2014 save it as CSV UTF-8 and try again.'
const REPLACEMENT_CHARACTER = '\uFFFD'
/** UTF-16 text of Latin characters is about half NUL bytes; a binary file has far fewer. */
const UTF16_NUL_SHARE = 0.25

/**
 * Text decoded as UTF-8 that was really UTF-16: the byte-order mark (FF FE or FE FF) decodes to
 * two replacement characters, and every second byte of Latin text is a NUL.
 */
function looksLikeUtf16(text: string): boolean {
  if (text.startsWith(REPLACEMENT_CHARACTER.repeat(2))) return true
  let nuls = 0
  for (const char of text) if (char === '\u0000') nuls += 1
  return nuls > 0 && nuls >= text.length * UTF16_NUL_SHARE
}

function looksLikeText(file: File): boolean {
  return /\.(csv|txt)$/i.test(file.name) || TEXT_TYPES.has(file.type)
}

/**
 * Reads a chosen file for the import dialog. Every refusal comes back as a message for the person
 * to read; nothing is thrown. The size is checked before the file is read, so a huge file is never
 * loaded. UTF-16 and binary files are refused with a message; a file with some undecodable
 * characters (Windows-1252, say) is read, with a warning.
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
  if (looksLikeUtf16(text)) return { error: UTF16_MESSAGE }
  if (text.includes('\u0000')) {
    return { error: 'That does not look like a text file. Export the data as CSV and try again.' }
  }

  const { rows } = readCsv(text)
  if (rows.length === 0) return { error: 'That file has no rows' }
  return text.includes(REPLACEMENT_CHARACTER)
    ? { rows, warning: 'Some characters could not be read \u2014 save the file as CSV UTF-8.' }
    : { rows }
}
