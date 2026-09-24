import { describe, expect, it } from 'vitest'
import { parseCsv, readCsv } from './csv'

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('does not need a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    const text = 'name,note\n"Smith, Jo","said ""hi"""\n"two\nlines",x\n'

    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Smith, Jo', 'said "hi"'],
      ['two\nlines', 'x'],
    ])
  })

  it('handles CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads a line break inside quotes as a single newline whatever its style', () => {
    expect(parseCsv('a\n"x\r\ny",1\n"p\rq",2\n')).toEqual([['a'], ['x\ny', '1'], ['p\nq', '2']])
  })

  it('drops a byte-order mark', () => {
    expect(parseCsv('﻿date,amount\n1,2')[0]).toEqual(['date', 'amount'])
  })

  it('skips blank lines and lines with only empty cells', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n   ,  \n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,c\n1,2,\n')).toEqual([
      ['a', '', 'c'],
      ['1', '2', ''],
    ])
    expect(parseCsv('1,2,')).toEqual([['1', '2', '']])
  })

  it('keeps ragged rows as they are', () => {
    expect(parseCsv('a,b,c\n1\n1,2,3,4\n')).toEqual([['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']])
  })

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,5', '3'],
    ])
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('does not mistake commas inside quotes for the delimiter', () => {
    expect(parseCsv('"a,b,c";d\n1;2')).toEqual([
      ['a,b,c', 'd'],
      ['1', '2'],
    ])
  })

  it('detects the delimiter from the first non-blank line and prefers a comma on a tie', () => {
    expect(parseCsv('\n\na;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a,b;c\n')).toEqual([['a', 'b;c']])
    expect(parseCsv('single\nvalue\n')).toEqual([['single'], ['value']])
  })

  it('keeps a quote in the middle of an unquoted field literally', () => {
    expect(parseCsv('5" pipe,ok\n')).toEqual([['5" pipe', 'ok']])
    expect(parseCsv('5" pipe;a,b;c\n1;2;3\n')).toEqual([
      ['5" pipe', 'a,b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('returns no rows for empty input and one row for a header-only file', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
    expect(parseCsv('date,amount,note\n')).toEqual([['date', 'amount', 'note']])
  })

  it('does not hang or throw on an unterminated quote', () => {
    expect(parseCsv('a,"b\nc')).toEqual([['a', 'b\nc']])
  })

  it('treats cells that look like formulas as plain text', () => {
    expect(parseCsv('=1+1,+SUM(A1),-5,@x\n')).toEqual([['=1+1', '+SUM(A1)', '-5', '@x']])
  })
})

describe('readCsv', () => {
  it('numbers rows by their first physical line and reports the delimiter', () => {
    const { rows, delimiter } = readCsv('a;b\n1;2\n3;4\n')

    expect(delimiter).toBe(';')
    expect(rows).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ])
  })

  it('counts blank lines', () => {
    const { rows } = readCsv('a,b\n\n1,2\n,\n\n3,4')

    expect(rows.map((row) => row.line)).toEqual([1, 3, 6])
  })

  it('points a row with a multi-line quoted field at its first line', () => {
    const { rows } = readCsv('h\n"x\ny\nz",1\nlast,2\n')

    expect(rows.map((row) => row.line)).toEqual([1, 2, 5])
  })

  it('counts CRLF, lone CR and LF each as one line, also inside quotes', () => {
    expect(readCsv('h\r\n"a\r\nb",1\r\nc,2\r\n').rows.map((row) => row.line)).toEqual([1, 2, 4])
    expect(readCsv('h\r\r1\r"a\rb",2\rz,3').rows.map((row) => row.line)).toEqual([1, 3, 4, 6])
    expect(readCsv('h\n\r\n1').rows.map((row) => row.line)).toEqual([1, 3])
  })

  it('is not thrown off by a byte-order mark', () => {
    const { rows } = readCsv('﻿date,amount\n1,2')

    expect(rows).toEqual([
      { line: 1, cells: ['date', 'amount'] },
      { line: 2, cells: ['1', '2'] },
    ])
  })

  it('returns nothing for an empty file and only the header for a header-only file', () => {
    expect(readCsv('').rows).toEqual([])
    expect(readCsv('\r\n\r\n').rows).toEqual([])
    expect(readCsv('date,amount\r\n').rows).toEqual([{ line: 1, cells: ['date', 'amount'] }])
  })

  it('flags an unterminated quote on its row and still reads the rows after it', () => {
    const { rows } = readCsv('date,note\n1,"oops\n2,fine\n3,fine\n')

    expect(rows.map((row) => row.line)).toEqual([1, 2, 3, 4])
    expect(rows[1]?.problem).toMatch(/quote opened on line 2/i)
    expect(rows[1]?.cells).toEqual(['1', '"oops'])
    expect(rows[2]).toEqual({ line: 3, cells: ['2', 'fine'] })
    expect(rows[3]).toEqual({ line: 4, cells: ['3', 'fine'] })
  })

  it('finds the line of an unterminated quote that opens after a multi-line field', () => {
    const { rows } = readCsv('h\n"a\nb",1\nx,"y\nz,2\n')

    expect(rows[1]).toEqual({ line: 2, cells: ['a\nb', '1'] })
    expect(rows[2]?.line).toBe(4)
    expect(rows[2]?.problem).toMatch(/line 4/)
    expect(rows[3]).toEqual({ line: 5, cells: ['z', '2'] })
  })

  it('flags text after a closing quote instead of silently gluing it on', () => {
    const { rows } = readCsv('a,b\n"x"y,2\n"ok" ,3\n')

    expect(rows[1]?.problem).toMatch(/after a closing quote/i)
    expect(rows[2]?.problem).toBeUndefined()
    expect(rows[2]?.cells[0]?.trim()).toBe('ok')
  })

  it('reports an unterminated quote at the very end of the file', () => {
    const { rows } = readCsv('a,b\n1,"')

    expect(rows.map((row) => row.line)).toEqual([1, 2])
    expect(rows[1]?.problem).toBeDefined()
  })

  it('parses a few megabytes in well under a second', () => {
    const record = '2026-09-01,-12.50,"Coffee, ""large"" cup"\r\n'
    const text = `date,amount,note\r\n${record.repeat(110_000)}`
    expect(text.length).toBeGreaterThan(4_500_000)

    const started = performance.now()
    const { rows } = readCsv(text)
    const elapsed = performance.now() - started

    expect(rows).toHaveLength(110_001)
    expect(rows.at(-1)).toEqual({
      line: 110_001,
      cells: ['2026-09-01', '-12.50', 'Coffee, "large" cup'],
    })
    expect(elapsed).toBeLessThan(1000)
  })

  it('stays linear when a quote is never closed in a large file', () => {
    const text = `a,"b\n${'x,y\n'.repeat(500_000)}`

    const started = performance.now()
    const { rows } = readCsv(text)
    const elapsed = performance.now() - started

    expect(rows).toHaveLength(500_001)
    expect(rows[0]?.problem).toBeDefined()
    expect(elapsed).toBeLessThan(1000)
  })
})
