import { isValidCurrencyCode, toMinorUnits } from '@/shared/lib/money'
import type { CsvRow } from './csv'
import type { Category, Transaction, TransactionInput, TransactionKind } from './types'

export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
export const DATE_FORMATS: DateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']

/** The limits the server enforces on every row of a bulk import; one bad row rejects its whole batch. */
const MAX_NOTE_LENGTH = 200
const MAX_AMOUNT_MINOR = 1_000_000_000_000
const MIN_YEAR = 2000
const MAX_YEAR = 2100

/** Longer than any amount written by a person; keeps the peeling below cheap on huge cells. */
const MAX_AMOUNT_TEXT_LENGTH = 40
const MAX_SHOWN_CELL_LENGTH = 30

export interface ImportMapping {
  dateColumn: number
  amountColumn: number
  noteColumn: number | null
  /** Never guessed: 03/04/2026 is 3 April or 4 March depending on this. Two-digit years are refused. */
  dateFormat: DateFormat
  /** true: negative amounts are spending (bank statements). false: positive amounts are spending (card exports). */
  negativeIsExpense: boolean
  expenseCategoryId: string
  incomeCategoryId: string
  currency: string
  /**
   * A column holding income/expense (or credit/debit). When set it decides the kind and the sign of
   * the amount is ignored.
   */
  kindColumn?: number | null
  /** A column holding a category name, matched to `categories` of the row's kind. Otherwise the default category is used. */
  categoryColumn?: number | null
  categories?: readonly Category[]
}

export interface ImportProblem {
  /** 1-based line of the file on which the row starts. */
  line: number
  message: string
}

const DATE_PATTERNS: Record<DateFormat, RegExp> = {
  'YYYY-MM-DD': /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/,
  'DD/MM/YYYY': /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/,
  'MM/DD/YYYY': /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/,
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function parseDate(value: string, format: DateFormat): string | null {
  const match = DATE_PATTERNS[format].exec(value.trim())
  if (!match) return null
  const [first = 0, , second = 0, third = 0] = match.slice(1).map((part) => Number(part))

  let year = first
  let month = second
  let day = third
  if (format === 'DD/MM/YYYY') [year, month, day] = [third, second, first]
  if (format === 'MM/DD/YYYY') [year, month, day] = [third, first, second]

  // Date.UTC rolls an impossible date (30 February) over and reads years 0 to 99 as 19xx,
  // so compare the parts to catch both.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const CURRENCY_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'))

const SYMBOL_LOCALES = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'de', 'fr', 'ja']
const symbolCache = new Map<string, readonly string[]>()

/**
 * The symbols a bank may print for `currency` ("$" and "US$" for USD, "¥" and "￥" for JPY),
 * as Intl produces them in a few fixed locales. Longest first, so "US$" is tried before "$".
 * A symbol not in this list, such as "€" or "¢" for USD, is never read as that currency.
 */
function currencySymbols(currency: string): readonly string[] {
  const cached = symbolCache.get(currency)
  if (cached) return cached
  const found = new Set<string>()
  if (isValidCurrencyCode(currency)) {
    for (const locale of SYMBOL_LOCALES) {
      for (const currencyDisplay of ['symbol', 'narrowSymbol'] as const) {
        const parts = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          currencyDisplay,
        }).formatToParts(1)
        for (const part of parts) {
          if (part.type === 'currency' && /\p{Sc}/u.test(part.value)) found.add(part.value)
        }
      }
    }
  }
  const symbols = [...found].sort((a, b) => b.length - a.length)
  symbolCache.set(currency, symbols)
  return symbols
}

const LEADING_SIGN = /^([+\-\u2212])\s*/
const TRAILING_SIGN = /\s*([+\-\u2212])$/
const LEADING_CODE = /^([A-Za-z]{3})\s*/
const TRAILING_CODE = /\s*([A-Za-z]{3})$/
const LEADING_FOREIGN_SYMBOL = /^[A-Za-z]{0,3}(\p{Sc})/u
const TRAILING_FOREIGN_SYMBOL = /(\p{Sc})$/u
const SPACED_THOUSANDS = /^\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?$/

type AmountReading = { minor: number; negative: boolean } | { mismatch: string } | null

function readAmount(value: string, currency: string): AmountReading {
  let text = value.trim()
  if (text.length === 0 || text.length > MAX_AMOUNT_TEXT_LENGTH) return null

  let negative = false
  let marks = 0
  let currencyMarks = 0

  const parenthesised = /^\((.*)\)$/s.exec(text)
  if (parenthesised) {
    text = (parenthesised[1] ?? '').trim()
    negative = true
    marks += 1
  }

  const wantedCode = currency.toUpperCase()
  const symbols = currencySymbols(currency)
  const peelSign = (pattern: RegExp): boolean => {
    const match = pattern.exec(text)
    if (!match) return false
    text = text.replace(pattern, '')
    if (match[1] !== '+') negative = true
    marks += 1
    return true
  }
  const peelSymbol = (side: 'leading' | 'trailing'): boolean => {
    for (const symbol of symbols) {
      if (side === 'leading' && text.startsWith(symbol)) {
        text = text.slice(symbol.length).trimStart()
        currencyMarks += 1
        return true
      }
      if (side === 'trailing' && text.endsWith(symbol)) {
        text = text.slice(0, -symbol.length).trimEnd()
        currencyMarks += 1
        return true
      }
    }
    return false
  }
  const peelCode = (pattern: RegExp): boolean => {
    const code = pattern.exec(text)?.[1]?.toUpperCase()
    if (code !== wantedCode) return false
    text = text.replace(pattern, '')
    currencyMarks += 1
    return true
  }

  let peeled = true
  while (peeled) {
    peeled =
      peelSign(LEADING_SIGN) ||
      peelSign(TRAILING_SIGN) ||
      peelSymbol('leading') ||
      peelSymbol('trailing') ||
      peelCode(LEADING_CODE) ||
      peelCode(TRAILING_CODE)
  }

  const foreignSymbol =
    LEADING_FOREIGN_SYMBOL.exec(text)?.[1] ?? TRAILING_FOREIGN_SYMBOL.exec(text)?.[1]
  if (foreignSymbol !== undefined && !symbols.includes(foreignSymbol)) {
    return { mismatch: `Currency symbol ${foreignSymbol} does not match ${wantedCode}` }
  }
  const foreignCode = (LEADING_CODE.exec(text) ?? TRAILING_CODE.exec(text))?.[1]?.toUpperCase()
  if (foreignCode !== undefined && CURRENCY_CODES.has(foreignCode)) {
    return { mismatch: `Currency code ${foreignCode} does not match ${wantedCode}` }
  }
  if (marks > 1 || currencyMarks > 1) return null

  const body = text.trim()
  if (/\s/.test(body) && !SPACED_THOUSANDS.test(body)) return null

  const minor = toMinorUnits(body, currency)
  return minor === null ? null : { minor, negative }
}

/**
 * The size and sign of an amount as written in a bank export: "-12.50", "(12.50)", "12.50-",
 * "$1,234.50", "-€ 1.234,50", "1 234,50", "USD 12.50". The digits go through `toMinorUnits`, so
 * nothing is rounded and an ambiguous or too precise amount is null. Text that is not an amount
 * with at most one sign, one pair of parentheses and one currency mark is null, and so is an
 * amount marked with another currency than `currency` (so "€12.30" is never read as dollars).
 */
export function parseSignedAmount(
  value: string,
  currency: string,
): { minor: number; negative: boolean } | null {
  const reading = readAmount(value, currency)
  return reading !== null && 'minor' in reading ? reading : null
}

export interface MappedRows {
  /** Rows in the shape the bulk endpoint takes, in file order. */
  valid: TransactionInput[]
  /** `lines[i]` is the file line on which `valid[i]` starts. */
  lines: number[]
  problems: ImportProblem[]
}

const INCOME_WORDS: ReadonlySet<string> = new Set(['income', 'credit', 'cr', 'deposit'])
const EXPENSE_WORDS: ReadonlySet<string> = new Set(['expense', 'debit', 'dr', 'withdrawal'])

function readKind(text: string): TransactionKind | null {
  const word = text.trim().toLowerCase()
  if (INCOME_WORDS.has(word)) return 'income'
  if (EXPENSE_WORDS.has(word)) return 'expense'
  return null
}

function nameKey(kind: TransactionKind, name: string): string {
  return `${kind}:${name.normalize('NFC').trim().toLowerCase()}`
}

function isFilled(cell: string): boolean {
  return cell.trim() !== ''
}

/** Cell text for a message, cut short so a huge cell cannot flood the preview. */
function shown(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_SHOWN_CELL_LENGTH
    ? `${trimmed.slice(0, MAX_SHOWN_CELL_LENGTH)}…`
    : trimmed
}

/** Collapses line breaks and runs of spaces, then cuts to the server's limit without splitting an emoji. */
function cleanNote(text: string): string {
  const note = text.replace(/\s+/g, ' ').trim()
  if (note.length <= MAX_NOTE_LENGTH) return note
  const lastCode = note.charCodeAt(MAX_NOTE_LENGTH - 1)
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? MAX_NOTE_LENGTH - 1 : MAX_NOTE_LENGTH
  return note.slice(0, end).trimEnd()
}

/**
 * Turns parsed rows into transactions in the shape the bulk endpoint takes. Every row that cannot
 * be turned into one is reported with its file line; none is dropped silently. The result keeps
 * the order of the file.
 *
 * With a header, a row with more cells than the header that has text beyond the header's width is
 * reported instead of mapped, since an unquoted comma shifts every later column. Empty extra cells
 * (a trailing delimiter) are ignored.
 *
 * The server numbers a rejected row ("Row N") from 1 within the batch it was sent, which holds
 * only valid rows, so it is not a file line. `lines` runs parallel to `valid` for that: send
 * `chunk(valid, size)` and, for a batch that starts at `valid` index `offset`, the file line of
 * "Row N" is `lines[offset + N - 1]`.
 */
export function mapRows(
  rows: readonly CsvRow[],
  mapping: ImportMapping,
  hasHeader: boolean,
): MappedRows {
  const valid: TransactionInput[] = []
  const lines: number[] = []
  const problems: ImportProblem[] = []

  const categoryIds = new Map<string, string>()
  for (const category of mapping.categories ?? []) {
    const key = nameKey(category.kind, category.name)
    if (!categoryIds.has(key)) categoryIds.set(key, category.id)
  }

  for (const [index, row] of rows.entries()) {
    const { line, cells } = row
    if (row.problem !== undefined) {
      problems.push({ line, message: row.problem })
      continue
    }
    if (hasHeader && index === 0) continue

    const headerWidth = hasHeader ? (rows[0]?.cells.length ?? 0) : 0
    if (hasHeader && cells.length > headerWidth && cells.slice(headerWidth).some(isFilled)) {
      problems.push({
        line,
        message: `This row has ${cells.length} columns but the header has ${headerWidth} \u2014 check for an unquoted comma in a text field`,
      })
      continue
    }

    const dateText = cells[mapping.dateColumn] ?? ''
    const date = parseDate(dateText, mapping.dateFormat)
    if (!date) {
      problems.push({ line, message: `Could not read the date "${shown(dateText)}"` })
      continue
    }
    const year = Number(date.slice(0, 4))
    if (year < MIN_YEAR || year > MAX_YEAR) {
      problems.push({
        line,
        message: `The date ${date} is outside ${MIN_YEAR} to ${MAX_YEAR}`,
      })
      continue
    }

    const amountText = cells[mapping.amountColumn] ?? ''
    const amount = readAmount(amountText, mapping.currency)
    if (amount === null) {
      problems.push({ line, message: `Could not read the amount "${shown(amountText)}"` })
      continue
    }
    if ('mismatch' in amount) {
      problems.push({ line, message: amount.mismatch })
      continue
    }
    if (amount.minor === 0) {
      problems.push({ line, message: 'The amount must be greater than zero' })
      continue
    }
    if (amount.minor > MAX_AMOUNT_MINOR) {
      problems.push({ line, message: 'The amount is too large' })
      continue
    }

    let kind: TransactionKind
    if (mapping.kindColumn === null || mapping.kindColumn === undefined) {
      kind = amount.negative === mapping.negativeIsExpense ? 'expense' : 'income'
    } else {
      const kindText = cells[mapping.kindColumn] ?? ''
      const columnKind = readKind(kindText)
      if (columnKind === null) {
        problems.push({
          line,
          message: `Could not read the type "${shown(kindText)}" (use income or expense)`,
        })
        continue
      }
      kind = columnKind
    }

    const defaultCategoryId =
      kind === 'expense' ? mapping.expenseCategoryId : mapping.incomeCategoryId
    const categoryText =
      mapping.categoryColumn === null || mapping.categoryColumn === undefined
        ? ''
        : (cells[mapping.categoryColumn] ?? '')
    const categoryId = categoryIds.get(nameKey(kind, categoryText)) ?? defaultCategoryId

    const noteText = mapping.noteColumn === null ? '' : (cells[mapping.noteColumn] ?? '')
    valid.push({ kind, amountMinor: amount.minor, categoryId, date, note: cleanNote(noteText) })
    lines.push(line)
  }
  return { valid, lines, problems }
}

function findColumn(header: readonly string[], patterns: RegExp[], taken: number[]): number | null {
  for (const pattern of patterns) {
    const index = header.findIndex(
      (name, position) => !taken.includes(position) && pattern.test(name),
    )
    if (index !== -1) return index
  }
  return null
}

/** Best guess at which columns hold the date, the amount and the description. */
export function guessColumns(header: readonly string[]): {
  dateColumn: number
  amountColumn: number
  noteColumn: number | null
} {
  const dateColumn = findColumn(header, [/date/i, /posted|time|day/i], []) ?? 0
  const amountColumn =
    findColumn(header, [/amount/i, /value|sum|debit|credit|total/i], [dateColumn]) ??
    (dateColumn === 0 ? 1 : 0)
  const noteColumn =
    findColumn(
      header,
      [/desc|memo|note|payee|narrative|detail|reference/i],
      [dateColumn, amountColumn],
    ) ??
    [0, 1, 2].find(
      (index) => index !== dateColumn && index !== amountColumn && index < header.length,
    ) ??
    null
  return { dateColumn, amountColumn, noteColumn }
}

/** Two transactions with the same key look like the same payment. */
export function duplicateKey(row: {
  date: string
  kind: string
  amountMinor: number
  note: string
}): string {
  return JSON.stringify([row.date, row.kind, row.amountMinor, cleanNote(row.note).toLowerCase()])
}

/** How many rows to import already exist. Only a warning: they are still imported if the user proceeds. */
export function countExistingDuplicates(
  rows: readonly TransactionInput[],
  existing: readonly Transaction[],
): number {
  const known = new Set(existing.map(duplicateKey))
  return rows.filter((row) => known.has(duplicateKey(row))).length
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError('Batch size must be a positive integer')
  const batches: T[][] = []
  for (let start = 0; start < items.length; start += size)
    batches.push(items.slice(start, start + size))
  return batches
}
