const DELIMITERS = [',', ';', '\t'] as const
const BYTE_ORDER_MARK = '﻿'

export interface CsvRow {
  /** 1-based physical line of the file on which the row starts (blank lines and multi-line fields counted). */
  line: number
  /** The physical line on which the row ends; larger than `line` when a quoted field runs over several lines. */
  endLine: number
  cells: string[]
  /** Set when the row is malformed and may not hold what its author meant. */
  problem?: string
}

export interface CsvDocument {
  rows: CsvRow[]
  delimiter: string
}

const SAMPLE_LINES = 5

/**
 * Picks the delimiter from the first few lines that hold something besides delimiters and spaces
 * (so a ";;;" lead row does not count), ignoring quoted text. The winner is the delimiter that
 * appears the same non-zero number of times on the most sampled lines, so a title line or a decimal
 * comma in a semicolon file does not outvote the real structure. Ties go to comma, semicolon, tab.
 * A quote only opens a quoted field at the start of a field, like in the parser itself.
 */
function detectDelimiter(text: string): string {
  const samples: number[][] = []
  let counts = DELIMITERS.map(() => 0)
  let inQuotes = false
  let atFieldStart = true
  let hasContent = false

  const endLine = () => {
    if (hasContent) samples.push(counts)
    counts = DELIMITERS.map(() => 0)
    atFieldStart = true
    hasContent = false
  }

  for (let index = 0; index < text.length && samples.length < SAMPLE_LINES; index += 1) {
    const char = text.charAt(index)
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(index + 1) === '"') index += 1
        else inQuotes = false
      }
    } else if (char === '\n' || char === '\r') {
      endLine()
    } else if (char === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
      hasContent = true
    } else {
      const position = DELIMITERS.indexOf(char as (typeof DELIMITERS)[number])
      if (position === -1) {
        atFieldStart = false
        if (char !== ' ') hasContent = true
      } else {
        counts[position] = (counts[position] ?? 0) + 1
        atFieldStart = true
      }
    }
  }
  if (samples.length < SAMPLE_LINES) endLine()

  let best = 0
  let bestAgreeing = 0
  let bestCount = 0
  for (const [position] of DELIMITERS.entries()) {
    const perLine = samples.map((line) => line[position] ?? 0).filter((count) => count > 0)
    for (const count of new Set(perLine)) {
      const agreeing = perLine.filter((other) => other === count).length
      if (agreeing > bestAgreeing || (agreeing === bestAgreeing && count > bestCount)) {
        best = position
        bestAgreeing = agreeing
        bestCount = count
      }
    }
  }
  return DELIMITERS[best] ?? ','
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '')
}

const TEXT_AFTER_QUOTE = 'Unexpected text after a closing quote'

/** A flagged row that spans several lines must name all of them, or the user cannot tell which were swallowed. */
function describeProblem(problem: string, first: number, last: number): string {
  if (last <= first) return problem
  const lines = `Lines ${first}\u2013${last}`
  if (problem === TEXT_AFTER_QUOTE) {
    return `${lines}: a quoted field runs over several lines and ends with unexpected text (check for a stray quote)`
  }
  return `${lines}: ${problem}`
}

/**
 * One pass over the text, linear in its length. With `recover`, a quote that is never closed does
 * not swallow the rest of the file: the text is read again from just after that quote, which is
 * kept as a literal character, and the row it opened is flagged. This happens at most once, so the
 * work stays at most twice the input.
 */
function scan(text: string, delimiter: string, recover: boolean): CsvRow[] {
  const rows: CsvRow[] = []
  let cells: string[] = []
  let field = ''
  let atFieldStart = true
  let inQuotes = false
  let justClosed = false
  let line = 1
  let rowLine = 1
  let problem: string | undefined

  let quoteIndex = 0
  let quoteLine = 1
  let quoteRowLine = 1
  let quoteRowCount = 0
  let quoteCells = cells
  let quoteCellCount = 0
  let quoteProblem: string | undefined

  const endRow = (endLine: number) => {
    cells.push(field)
    if (problem !== undefined) {
      const described = describeProblem(problem, rowLine, endLine)
      rows.push({ line: rowLine, endLine, cells, problem: described })
    } else if (!isBlank(cells)) {
      rows.push({ line: rowLine, endLine, cells })
    }
    cells = []
    field = ''
    atFieldStart = true
    justClosed = false
    problem = undefined
    rowLine = line
  }

  let recovered = false
  let index = 0
  for (;;) {
    for (; index < text.length; index += 1) {
      const char = text.charAt(index)

      if (inQuotes) {
        if (char === '"') {
          if (text.charAt(index + 1) === '"') {
            field += '"'
            index += 1
          } else {
            inQuotes = false
            justClosed = true
          }
        } else if (char === '\n' || char === '\r') {
          if (char === '\r' && text.charAt(index + 1) === '\n') index += 1
          line += 1
          field += '\n'
        } else {
          field += char
        }
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text.charAt(index + 1) === '\n') index += 1
        line += 1
        endRow(line - 1)
      } else if (char === delimiter) {
        cells.push(field)
        field = ''
        atFieldStart = true
        justClosed = false
      } else if (char === '"' && atFieldStart) {
        inQuotes = true
        atFieldStart = false
        quoteIndex = index
        quoteLine = line
        quoteRowLine = rowLine
        quoteRowCount = rows.length
        quoteCells = cells
        quoteCellCount = cells.length
        quoteProblem = problem
      } else {
        atFieldStart = false
        if (justClosed && char !== ' ') problem = TEXT_AFTER_QUOTE
        field += char
      }
    }

    if (!inQuotes) break
    const message = `The quote opened on line ${quoteLine} is never closed`
    if (!recover || recovered) {
      problem = problem ?? message
      break
    }
    recovered = true
    rows.length = quoteRowCount
    cells = quoteCells
    cells.length = quoteCellCount
    field = '"'
    atFieldStart = false
    inQuotes = false
    justClosed = false
    line = quoteLine
    rowLine = quoteRowLine
    problem = quoteProblem ?? message
    index = quoteIndex + 1
  }

  if (field !== '' || cells.length > 0 || problem !== undefined) endRow(line)
  return rows
}

function prepare(input: string): { text: string; delimiter: string } {
  const text = input.startsWith(BYTE_ORDER_MARK) ? input.slice(1) : input
  return { text, delimiter: detectDelimiter(text) }
}

/**
 * Reads CSV text into rows that remember their line in the file, so a problem can be reported
 * where the user will find it. Handles quoted fields (delimiters, line breaks and doubled quotes
 * inside them), CRLF, LF and lone CR, a leading byte-order mark, and comma, semicolon or tab
 * delimiters. Blank rows are dropped; malformed ones are kept and flagged in `problem`.
 */
export function readCsv(input: string): CsvDocument {
  const { text, delimiter } = prepare(input)
  return { rows: scan(text, delimiter, true), delimiter }
}

/** Like `readCsv` but only the cells, and a quote that is never closed runs to the end of the input. */
export function parseCsv(input: string): string[][] {
  const { text, delimiter } = prepare(input)
  return scan(text, delimiter, false).map((row) => row.cells)
}
