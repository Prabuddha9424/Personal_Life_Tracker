import { describe, expect, it } from 'vitest'
import { readCsv } from './csv'

describe('readCsv', () => {
  it('numbers rows by their first physical line and reports the delimiter', () => {
    const { rows, delimiter } = readCsv('a;b\n1;2\n3;4\n')

    expect(delimiter).toBe(';')
    expect(rows).toEqual([
      { line: 1, endLine: 1, cells: ['a', 'b'] },
      { line: 2, endLine: 2, cells: ['1', '2'] },
      { line: 3, endLine: 3, cells: ['3', '4'] },
    ])
  })

  it('records the last line of each row, so a multi-line row can be named in full', () => {
    const { rows } = readCsv('h\n\n"x\ny\nz",1\n\nlast,2')

    expect(rows.map((row) => [row.line, row.endLine])).toEqual([
      [1, 1],
      [3, 5],
      [7, 7],
    ])
  })

  it('names every line a flagged multi-line row swallowed', () => {
    const { rows } = readCsv(
      [
        'date,amount,note',
        '2026-09-01,-5,"12',
        '2026-09-02,-6,fine',
        '2026-09-03,-7,"Joe\'s" diner',
        '2026-09-04,-8,ok',
      ].join('\n'),
    )

    expect(rows.map((row) => [row.line, row.endLine])).toEqual([
      [1, 1],
      [2, 4],
      [5, 5],
    ])
    expect(rows[1]?.problem).toBe(
      'Lines 2\u20134: a quoted field runs over several lines and ends with unexpected text (check for a stray quote)',
    )
    expect(rows[2]?.problem).toBeUndefined()
  })

  describe('a multi-line note that holds what look like other rows', () => {
    const stray = (delimiter: string) =>
      [
        ['date', 'amount', 'note'].join(delimiter),
        ['2026-09-01', '-5', '"12 inch pizza'].join(delimiter),
        ['2026-09-02', '-6', 'fine'].join(delimiter),
        ['2026-09-03', '-7', 'TV 55"'].join(delimiter),
        ['2026-09-04', '-8', 'ok'].join(delimiter),
      ].join('\n')

    it.each([',', ';', '\t'])('flags the swallowed rows with %j as the delimiter', (delimiter) => {
      const { rows } = readCsv(stray(delimiter))

      expect(rows.map((row) => [row.line, row.endLine])).toEqual([
        [1, 1],
        [2, 4],
        [5, 5],
      ])
      expect(rows[1]?.problem).toBe(
        'Lines 2\u20134: this note runs over several lines and contains what look like other rows \u2014 check for a stray quote',
      )
      expect(rows[2]?.problem).toBeUndefined()
    })

    it('recognises the other supported date shapes', () => {
      for (const line of ['5/9/2026,-6,x', '05.09.2026,-6,x', '  2026/9/2 , -6,x']) {
        const { rows } = readCsv(`date,amount,note\n1,2,"a\n${line}"\n`)

        expect(rows[1]?.problem).toMatch(/other rows/)
      }
    })

    it.each([
      ['an address', '"Home\n12 High Street\nLondon"'],
      ['a bullet list', '"shopping\n- milk\n- eggs\n* bread"'],
      ['a date in the middle of a line', '"trip\nPaid on 2026-09-02 by card"'],
      ['a date and a space but no delimiter', '"trip\n2026-09-02 lunch with Sam"'],
      ['a date followed by the other delimiter', '"trip\n2026-09-02; lunch"'],
      ['a number that is not a date', '"trip\n12,50 was the price"'],
      ['a date on the first line only', '"2026-09-02,-6,x\nsecond line"'],
    ])('does not flag %s', (_name, note) => {
      const { rows } = readCsv(`date,amount,note\n2026-09-01,-5,${note}\n2026-09-04,-8,ok\n`)

      const swallowed = rows[1]
      expect(swallowed?.problem).toBeUndefined()
      expect(swallowed?.endLine).toBeGreaterThan(swallowed?.line ?? 0)
      expect(rows[2]?.cells).toEqual(['2026-09-04', '-8', 'ok'])
      expect(rows[2]?.line).toBe((swallowed?.endLine ?? 0) + 1)
    })
  })

  it('names the lines of a multi-line row that also holds an unclosed quote', () => {
    const { rows } = readCsv('h\n"a\nb",x,"oops\nnext,1\n')

    expect(rows[1]).toMatchObject({ line: 2, endLine: 3 })
    expect(rows[1]?.problem).toBe('Lines 2\u20133: The quote opened on line 3 is never closed')
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
      { line: 1, endLine: 1, cells: ['date', 'amount'] },
      { line: 2, endLine: 2, cells: ['1', '2'] },
    ])
  })

  it('returns nothing for an empty file and only the header for a header-only file', () => {
    expect(readCsv('').rows).toEqual([])
    expect(readCsv('\r\n\r\n').rows).toEqual([])
    expect(readCsv('date,amount\r\n').rows).toEqual([
      { line: 1, endLine: 1, cells: ['date', 'amount'] },
    ])
  })

  it('flags an unterminated quote on its row and still reads the rows after it', () => {
    const { rows } = readCsv('date,note\n1,"oops\n2,fine\n3,fine\n')

    expect(rows.map((row) => row.line)).toEqual([1, 2, 3, 4])
    expect(rows[1]?.problem).toMatch(/quote opened on line 2/i)
    expect(rows[1]?.cells).toEqual(['1', '"oops'])
    expect(rows[2]).toEqual({ line: 3, endLine: 3, cells: ['2', 'fine'] })
    expect(rows[3]).toEqual({ line: 4, endLine: 4, cells: ['3', 'fine'] })
  })

  it('finds the line of an unterminated quote that opens after a multi-line field', () => {
    const { rows } = readCsv('h\n"a\nb",1\nx,"y\nz,2\n')

    expect(rows[1]).toEqual({ line: 2, endLine: 3, cells: ['a\nb', '1'] })
    expect(rows[2]?.line).toBe(4)
    expect(rows[2]?.problem).toMatch(/line 4/)
    expect(rows[3]).toEqual({ line: 5, endLine: 5, cells: ['z', '2'] })
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
      endLine: 110_001,
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
