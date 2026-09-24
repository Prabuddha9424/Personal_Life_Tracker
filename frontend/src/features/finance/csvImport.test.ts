import { describe, expect, it } from 'vitest'
import { readCsv, type CsvRow } from './csv'
import {
  chunk,
  countExistingDuplicates,
  duplicateKey,
  guessColumns,
  mapRows,
  parseDate,
  parseSignedAmount,
  type ImportMapping,
} from './csvImport'
import type { Category, Transaction } from './types'

/** Rows numbered like a file without blank lines or multi-line fields. */
function fileRows(cells: string[][]): CsvRow[] {
  return cells.map((row, index) => ({ line: index + 1, cells: row }))
}

describe('parseDate', () => {
  it.each([
    ['2026-09-05', 'YYYY-MM-DD', '2026-09-05'],
    ['2026-9-5', 'YYYY-MM-DD', '2026-09-05'],
    ['2026/09/05', 'YYYY-MM-DD', '2026-09-05'],
    ['05/09/2026', 'DD/MM/YYYY', '2026-09-05'],
    ['5.9.2026', 'DD/MM/YYYY', '2026-09-05'],
    ['5-9-2026', 'DD/MM/YYYY', '2026-09-05'],
    ['09/05/2026', 'MM/DD/YYYY', '2026-09-05'],
    [' 2026-12-31 ', 'YYYY-MM-DD', '2026-12-31'],
    ['29/02/2028', 'DD/MM/YYYY', '2028-02-29'],
    ['29/02/2000', 'DD/MM/YYYY', '2000-02-29'],
  ] as const)('reads %j as %s', (value, format, expected) => {
    expect(parseDate(value, format)).toBe(expected)
  })

  it.each([
    ['2026-02-30', 'YYYY-MM-DD'],
    ['2026-00-10', 'YYYY-MM-DD'],
    ['2026-01-00', 'YYYY-MM-DD'],
    ['29/02/2027', 'DD/MM/YYYY'],
    ['29/02/2100', 'DD/MM/YYYY'],
    ['31/04/2026', 'DD/MM/YYYY'],
    ['13/13/2026', 'MM/DD/YYYY'],
    ['13/01/2026', 'MM/DD/YYYY'],
    ['05/09/26', 'DD/MM/YYYY'],
    ['5.9.26', 'DD/MM/YYYY'],
    ['26-09-05', 'YYYY-MM-DD'],
    ['0000-01-01', 'YYYY-MM-DD'],
    ['0099-01-01', 'YYYY-MM-DD'],
    ['5/9.2026', 'DD/MM/YYYY'],
    ['2026-09-05T10:00:00Z', 'YYYY-MM-DD'],
    ['', 'YYYY-MM-DD'],
    ['yesterday', 'YYYY-MM-DD'],
    ['2026-09-05', 'DD/MM/YYYY'],
    ['٢٠٢٦-٠٩-٠٥', 'YYYY-MM-DD'],
  ] as const)('rejects %j as %s', (value, format) => {
    expect(parseDate(value, format)).toBeNull()
  })

  it('never guesses the order: the same text reads differently under each format', () => {
    expect(parseDate('03/04/2026', 'DD/MM/YYYY')).toBe('2026-04-03')
    expect(parseDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04')
  })
})

describe('parseSignedAmount', () => {
  it.each([
    ['12.34', 'USD', { minor: 1234, negative: false }],
    ['-12.34', 'USD', { minor: 1234, negative: true }],
    ['+5', 'USD', { minor: 500, negative: false }],
    ['(45.10)', 'USD', { minor: 4510, negative: true }],
    ['( 45.10 )', 'USD', { minor: 4510, negative: true }],
    ['12.34-', 'USD', { minor: 1234, negative: true }],
    ['−7.00', 'USD', { minor: 700, negative: true }],
    ['$1,234.50', 'USD', { minor: 123450, negative: false }],
    ['-$1,234.50', 'USD', { minor: 123450, negative: true }],
    ['$-5.00', 'USD', { minor: 500, negative: true }],
    ['($5.00)', 'USD', { minor: 500, negative: true }],
    ['5.00 $', 'USD', { minor: 500, negative: false }],
    ['-€ 1.234,50', 'EUR', { minor: 123450, negative: true }],
    ['12,50', 'EUR', { minor: 1250, negative: false }],
    ['1 234,50', 'EUR', { minor: 123450, negative: false }],
    ['1 234 567.89', 'USD', { minor: 123456789, negative: false }],
    ['USD 12.34', 'USD', { minor: 1234, negative: false }],
    ['12.34 usd', 'USD', { minor: 1234, negative: false }],
    ['-500', 'JPY', { minor: 500, negative: true }],
    ['¥1,500', 'JPY', { minor: 1500, negative: false }],
    ['JPY 500', 'JPY', { minor: 500, negative: false }],
    ['1.234', 'BHD', { minor: 1234, negative: false }],
    ['0,500', 'BHD', { minor: 500, negative: false }],
    ['1.234,567', 'BHD', { minor: 1234567, negative: false }],
    ['1,234.567', 'BHD', { minor: 1234567, negative: false }],
    ['0.00', 'USD', { minor: 0, negative: false }],
    ['-0.00', 'USD', { minor: 0, negative: true }],
  ] as const)('reads %j in %s', (value, currency, expected) => {
    expect(parseSignedAmount(value, currency)).toEqual(expected)
  })

  it.each([
    ['', 'USD'],
    ['   ', 'USD'],
    ['abc', 'USD'],
    ['-', 'USD'],
    ['()', 'USD'],
    ['$', 'USD'],
    ['1.234', 'USD'],
    ['5.5', 'JPY'],
    ['12.3.4', 'USD'],
    ['1,234', 'BHD'],
    ['12abc34', 'USD'],
    ['abc5', 'USD'],
    ['1e5', 'USD'],
    ['0x10', 'USD'],
    ['--5', 'USD'],
    ['-5-', 'USD'],
    ['(-5)', 'USD'],
    ['(5', 'USD'],
    ['5+5', 'USD'],
    ['€5€', 'EUR'],
    ['12.00 EUR', 'USD'],
    ['12 50', 'USD'],
    ['1 23', 'USD'],
    ['1 2345', 'USD'],
    ['NaN', 'USD'],
    ['Infinity', 'USD'],
    ['9'.repeat(30), 'USD'],
    ['9'.repeat(5000), 'USD'],
    ['٥.00', 'USD'],
    ['5.00', 'not a currency'],
  ] as const)('rejects %j in %s', (value, currency) => {
    expect(parseSignedAmount(value, currency)).toBeNull()
  })
})

const mapping: ImportMapping = {
  dateColumn: 0,
  amountColumn: 1,
  noteColumn: 2,
  dateFormat: 'YYYY-MM-DD',
  negativeIsExpense: true,
  expenseCategoryId: 'cat-expense',
  incomeCategoryId: 'cat-income',
  currency: 'USD',
}

describe('mapRows', () => {
  const rows = fileRows([
    ['Date', 'Amount', 'Description'],
    ['2026-09-01', '-12.50', 'Coffee'],
    ['2026-09-02', '3000.00', 'Salary'],
  ])

  it('skips the header and turns rows into transactions with the chosen categories', () => {
    const { valid, problems } = mapRows(rows, mapping, true)

    expect(problems).toEqual([])
    expect(valid).toEqual([
      {
        kind: 'expense',
        amountMinor: 1250,
        categoryId: 'cat-expense',
        date: '2026-09-01',
        note: 'Coffee',
      },
      {
        kind: 'income',
        amountMinor: 300000,
        categoryId: 'cat-income',
        date: '2026-09-02',
        note: 'Salary',
      },
    ])
  })

  it('treats the first row as data when there is no header', () => {
    const { valid, problems } = mapRows(rows.slice(1), mapping, false)

    expect(valid).toHaveLength(2)
    expect(problems).toEqual([])
  })

  it('flips the sign convention for card exports where a positive amount is spending', () => {
    const { valid } = mapRows(rows, { ...mapping, negativeIsExpense: false }, true)

    expect(valid.map((row) => row.kind)).toEqual(['income', 'expense'])
  })

  it('treats parentheses and a trailing minus as negative', () => {
    const { valid } = mapRows(
      fileRows([
        ['2026-09-01', '(10.00)', ''],
        ['2026-09-01', '10.00-', ''],
        ['2026-09-01', '10.00', ''],
      ]),
      mapping,
      false,
    )

    expect(valid.map((row) => row.kind)).toEqual(['expense', 'expense', 'income'])
  })

  it('reports each bad row by its file line and keeps the good ones', () => {
    const bad = fileRows([
      ['Date', 'Amount', 'Description'],
      ['2026-09-01', '-12.50', 'ok'],
      ['not a date', '-5', 'bad date'],
      ['2026-09-03', 'lots', 'bad amount'],
      ['2026-09-04', '0', 'zero'],
      ['2026-09-05', '-1.00', 'fine'],
    ])

    const { valid, problems } = mapRows(bad, mapping, true)

    expect(valid.map((row) => row.note)).toEqual(['ok', 'fine'])
    expect(problems).toEqual([
      { line: 3, message: 'Could not read the date "not a date"' },
      { line: 4, message: 'Could not read the amount "lots"' },
      { line: 5, message: 'The amount must be greater than zero' },
    ])
  })

  it('reports lines of the file, not positions among the parsed rows', () => {
    const text = [
      'date,amount,note',
      '',
      '2026-09-01,-1.00,"two',
      'lines"',
      '',
      'oops,-2.00,bad date',
      '2026-09-03,-3.00,fine',
    ].join('\r\n')

    const { valid, problems } = mapRows(readCsv(text).rows, mapping, true)

    expect(valid.map((row) => row.note)).toEqual(['two lines', 'fine'])
    expect(problems).toEqual([{ line: 6, message: 'Could not read the date "oops"' }])
  })

  it('reports a malformed row from the reader and never imports it', () => {
    const { rows: parsed } = readCsv(
      'date,amount,note\n2026-09-01,-1.00,"oops\n2026-09-02,-2.00,fine\n',
    )

    const { valid, problems } = mapRows(parsed, mapping, true)

    expect(valid.map((row) => row.note)).toEqual(['fine'])
    expect(problems).toEqual([{ line: 2, message: 'The quote opened on line 2 is never closed' }])
  })

  it('reports a malformed header row too', () => {
    const { valid, problems } = mapRows(
      [
        {
          line: 1,
          cells: ['date', 'amount', 'note'],
          problem: 'Unexpected text after a closing quote',
        },
        { line: 2, cells: ['2026-09-01', '-1', 'x'] },
      ],
      mapping,
      true,
    )

    expect(valid).toHaveLength(1)
    expect(problems).toEqual([{ line: 1, message: 'Unexpected text after a closing quote' }])
  })

  it('handles a short row and a missing note column', () => {
    const { valid, problems } = mapRows(
      fileRows([['2026-09-01'], ['2026-09-02', '-1', 'x']]),
      { ...mapping, noteColumn: null },
      false,
    )

    expect(problems).toEqual([{ line: 1, message: 'Could not read the amount ""' }])
    expect(valid).toEqual([
      {
        kind: 'expense',
        amountMinor: 100,
        categoryId: 'cat-expense',
        date: '2026-09-02',
        note: '',
      },
    ])
  })

  it('ignores extra cells on a long row', () => {
    const { valid, problems } = mapRows(
      fileRows([['2026-09-01', '-1', 'x', 'extra', 'more']]),
      mapping,
      false,
    )

    expect(problems).toEqual([])
    expect(valid).toHaveLength(1)
  })

  it('trims notes, joins their lines and truncates to 200 characters', () => {
    const { valid } = mapRows(
      fileRows([
        ['2026-09-02', '-1', `  ${'x'.repeat(300)}  `],
        ['2026-09-02', '-1', '  a\n  b\t\tc  '],
        ['2026-09-02', '-1', '=HYPERLINK("http://evil")'],
      ]),
      mapping,
      false,
    )

    expect(valid[0]?.note).toBe('x'.repeat(200))
    expect(valid[1]?.note).toBe('a b c')
    expect(valid[2]?.note).toBe('=HYPERLINK("http://evil")')
  })

  it('does not cut an emoji in half when truncating', () => {
    const note = `${'x'.repeat(199)}\u{1F600}tail`
    const { valid } = mapRows(fileRows([['2026-09-02', '-1', note]]), mapping, false)

    expect(valid[0]?.note).toBe('x'.repeat(199))
  })

  it('returns nothing for a header-only file and for no rows', () => {
    expect(mapRows(fileRows([['Date', 'Amount']]), mapping, true)).toEqual({
      valid: [],
      problems: [],
    })
    expect(mapRows([], mapping, true)).toEqual({ valid: [], problems: [] })
  })

  it('uses whole minor units for currencies without decimals and three decimals for BHD', () => {
    const jpy = mapRows(
      fileRows([['2026-09-01', '-500', 'ramen']]),
      { ...mapping, currency: 'JPY' },
      false,
    )
    const bhd = mapRows(
      fileRows([['2026-09-01', '-1.234', 'tea']]),
      { ...mapping, currency: 'BHD' },
      false,
    )

    expect(jpy.valid[0]?.amountMinor).toBe(500)
    expect(bhd.valid[0]?.amountMinor).toBe(1234)
  })

  it('reports ambiguous and too precise amounts instead of guessing', () => {
    const { valid, problems } = mapRows(
      fileRows([
        ['2026-09-01', '-1,234', 'ambiguous for BHD'],
        ['2026-09-01', '-1.2345', 'too precise'],
      ]),
      { ...mapping, currency: 'BHD' },
      false,
    )

    expect(valid).toEqual([])
    expect(problems.map((problem) => problem.line)).toEqual([1, 2])
    expect(problems[0]?.message).toBe('Could not read the amount "-1,234"')
  })

  it('reports dates the server would refuse', () => {
    const { valid, problems } = mapRows(
      fileRows([
        ['1999-12-31', '-1', ''],
        ['2101-01-01', '-1', ''],
        ['2000-01-01', '-1', ''],
        ['2100-12-31', '-1', ''],
      ]),
      mapping,
      false,
    )

    expect(valid.map((row) => row.date)).toEqual(['2000-01-01', '2100-12-31'])
    expect(problems.map((problem) => problem.message)).toEqual([
      'The date 1999-12-31 is outside 2000 to 2100',
      'The date 2101-01-01 is outside 2000 to 2100',
    ])
  })

  it('reports an amount above the limit the server accepts', () => {
    const { valid, problems } = mapRows(
      fileRows([
        ['2026-09-01', '-10000000000.00', ''],
        ['2026-09-01', '-10000000000.01', ''],
      ]),
      mapping,
      false,
    )

    expect(valid).toHaveLength(1)
    expect(problems).toEqual([{ line: 2, message: 'The amount is too large' }])
  })

  it('shortens a very long cell in a message', () => {
    const { problems } = mapRows(fileRows([['x'.repeat(10_000), '-1', '']]), mapping, false)

    expect(problems[0]?.message.length).toBeLessThan(80)
    expect(problems[0]?.message).toContain('…')
  })

  describe('kind and category columns', () => {
    const categories: Category[] = [
      { id: 'exp-food', name: 'Food', kind: 'expense' },
      { id: 'exp-fun', name: 'Fun', kind: 'expense' },
      { id: 'inc-pay', name: 'Salary', kind: 'income' },
      { id: 'inc-food', name: 'Food', kind: 'income' },
    ]
    const wide: ImportMapping = {
      ...mapping,
      kindColumn: 3,
      categoryColumn: 4,
      categories,
    }

    it('matches a category by name, ignoring case and spaces, within the row kind', () => {
      const { valid, problems } = mapRows(
        fileRows([
          ['2026-09-01', '-5', 'a', '', ' FOOD '],
          ['2026-09-01', '5', 'b', '', 'food'],
          ['2026-09-01', '5', 'c', '', 'salary'],
          ['2026-09-01', '-5', 'd', '', 'salary'],
          ['2026-09-01', '-5', 'e', '', 'unknown'],
          ['2026-09-01', '-5', 'f', '', ''],
        ]),
        { ...wide, kindColumn: null },
        false,
      )

      expect(problems).toEqual([])
      expect(valid.map((row) => row.categoryId)).toEqual([
        'exp-food',
        'inc-food',
        'inc-pay',
        'cat-expense',
        'cat-expense',
        'cat-expense',
      ])
    })

    it('reads the kind from a column and takes the size of the amount', () => {
      const { valid, problems } = mapRows(
        fileRows([
          ['2026-09-01', '5.00', 'a', 'Debit', 'fun'],
          ['2026-09-01', '-5.00', 'b', 'credit', 'salary'],
          ['2026-09-01', '5.00', 'c', ' INCOME ', ''],
          ['2026-09-01', '5.00', 'd', 'expense', ''],
          ['2026-09-01', '5.00', 'e', 'transfer', ''],
          ['2026-09-01', '5.00', 'f', '', ''],
        ]),
        wide,
        false,
      )

      expect(valid.map((row) => [row.kind, row.categoryId])).toEqual([
        ['expense', 'exp-fun'],
        ['income', 'inc-pay'],
        ['income', 'cat-income'],
        ['expense', 'cat-expense'],
      ])
      expect(problems).toEqual([
        { line: 5, message: 'Could not read the type "transfer" (use income or expense)' },
        { line: 6, message: 'Could not read the type "" (use income or expense)' },
      ])
    })
  })
})

describe('guessColumns', () => {
  it('finds the date, amount and description columns by their header names', () => {
    expect(guessColumns(['Posted Date', 'Payee', 'Amount (USD)', 'Balance'])).toEqual({
      dateColumn: 0,
      amountColumn: 2,
      noteColumn: 1,
    })
  })

  it('prefers the most telling name and never picks one column twice', () => {
    expect(guessColumns(['Running total', 'Amount', 'Transaction Date', 'Memo'])).toEqual({
      dateColumn: 2,
      amountColumn: 1,
      noteColumn: 3,
    })
    expect(guessColumns(['Date', 'Date posted', 'Description'])).toEqual({
      dateColumn: 0,
      amountColumn: 1,
      noteColumn: 2,
    })
  })

  it('falls back to the first columns when the names give no clue', () => {
    expect(guessColumns(['A', 'B', 'C'])).toEqual({ dateColumn: 0, amountColumn: 1, noteColumn: 2 })
    expect(guessColumns(['A', 'B'])).toEqual({ dateColumn: 0, amountColumn: 1, noteColumn: null })
  })

  it('copes with an empty header', () => {
    expect(guessColumns([])).toEqual({ dateColumn: 0, amountColumn: 1, noteColumn: null })
  })
})

describe('duplicates', () => {
  const coffee: Transaction = {
    id: '1',
    kind: 'expense',
    amountMinor: 1250,
    currency: 'USD',
    categoryId: 'c',
    date: '2026-09-01',
    note: 'Coffee',
  }
  const existing = [coffee]

  it('builds a key from date, kind, amount and a case-insensitive note', () => {
    expect(
      duplicateKey({ date: '2026-09-01', kind: 'expense', amountMinor: 1250, note: ' COFFEE ' }),
    ).toBe(duplicateKey(coffee))
  })

  it('counts imported rows that match an existing transaction', () => {
    const rows = [
      {
        kind: 'expense' as const,
        amountMinor: 1250,
        categoryId: 'x',
        date: '2026-09-01',
        note: 'coffee',
      },
      {
        kind: 'expense' as const,
        amountMinor: 1251,
        categoryId: 'x',
        date: '2026-09-01',
        note: 'coffee',
      },
      {
        kind: 'income' as const,
        amountMinor: 1250,
        categoryId: 'x',
        date: '2026-09-01',
        note: 'coffee',
      },
    ]

    expect(countExistingDuplicates(rows, existing)).toBe(1)
  })
})

describe('chunk', () => {
  it('splits into batches and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 500)).toEqual([])
    expect(chunk([1], 500)).toEqual([[1]])
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('refuses a size that would never advance', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
    expect(() => chunk([1], -1)).toThrow(RangeError)
    expect(() => chunk([1], 1.5)).toThrow(RangeError)
    expect(() => chunk([1], Number.NaN)).toThrow(RangeError)
  })
})
