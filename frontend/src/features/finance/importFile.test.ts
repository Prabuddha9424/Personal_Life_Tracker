import { describe, expect, it } from 'vitest'
import { readImportFile } from './importFile'

function file(content: BlobPart, name = 'bank.csv', type = 'text/csv') {
  return new File([content], name, { type })
}

describe('readImportFile', () => {
  it('reads a CSV file into rows that remember their line', async () => {
    const result = await readImportFile(file('Date,Amount\n2026-09-01,-1.00\n'))

    expect(result).toMatchObject({ rows: [{ line: 1 }, { line: 2 }] })
  })

  it('accepts .txt and .csv files whatever the browser reports as their type', async () => {
    expect(await readImportFile(file('a,b\n1,2\n', 'export.txt', 'text/plain'))).toHaveProperty(
      'rows',
    )
    expect(await readImportFile(file('a,b\n1,2\n', 'export.CSV', ''))).toHaveProperty('rows')
    expect(
      await readImportFile(file('a,b\n1,2\n', 'export', 'application/vnd.ms-excel')),
    ).toHaveProperty('rows')
  })

  it('refuses another kind of file', async () => {
    expect(await readImportFile(file('x', 'photo.png', 'image/png'))).toEqual({
      error: 'Choose a .csv or .txt file',
    })
  })

  it('refuses a file over 5 MB without reading it', async () => {
    const big = file('a,b\n')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })

    expect(await readImportFile(big)).toEqual({
      error:
        'That file is larger than 5 MB. Split it into smaller files and import them one at a time.',
    })
  })

  it('names a UTF-16 file, as Excel saves "Unicode Text", by its byte-order mark', async () => {
    const units = Array.from('Date\tAmount\r\n2026-09-01\t-1.00\r\n').flatMap((char) => [
      char.charCodeAt(0),
      0,
    ])
    const le = file(new Uint8Array([0xff, 0xfe, ...units]), 'export.txt', 'text/plain')
    const be = file(new Uint8Array([0xfe, 0xff, 0, 68, 0, 97]), 'export.txt', 'text/plain')

    for (const utf16 of [le, be]) {
      expect(await readImportFile(utf16)).toEqual({
        error:
          'This looks like a UTF-16 (Excel "Unicode Text") file \u2014 save it as CSV UTF-8 and try again.',
      })
    }
  })

  it('names a UTF-16 file without a byte-order mark by its NUL bytes', async () => {
    const units = Array.from('Date,Amount\n2026-09-01,-1.00\n').flatMap((char) => [
      char.charCodeAt(0),
      0,
    ])

    expect(await readImportFile(file(new Uint8Array(units)))).toEqual({
      error:
        'This looks like a UTF-16 (Excel "Unicode Text") file \u2014 save it as CSV UTF-8 and try again.',
    })
  })

  it('warns, without refusing, when some characters could not be decoded', async () => {
    // "Caf\xe9" in Windows-1252 is not valid UTF-8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Date,Note\n2026-09-01,Caf'),
      0xe9,
      0x0a,
    ])

    const result = await readImportFile(file(bytes))

    expect(result).toMatchObject({
      rows: [{ line: 1 }, { line: 2 }],
      warning: 'Some characters could not be read \u2014 save the file as CSV UTF-8.',
    })
  })

  it('gives no warning for a clean file', async () => {
    expect(await readImportFile(file('a,b\n1,2\n'))).not.toHaveProperty('warning')
  })

  it('refuses a binary file', async () => {
    const result = await readImportFile(file('PK\u0003\u0004\u0000\u0000binary'))

    expect(result).toEqual({
      error: 'That does not look like a text file. Export the data as CSV and try again.',
    })
  })

  it('says an empty file, or one with only blank lines, has no rows', async () => {
    expect(await readImportFile(file(''))).toEqual({ error: 'That file has no rows' })
    expect(await readImportFile(file('\n\n  \n'))).toEqual({ error: 'That file has no rows' })
  })

  it('reports a file that cannot be read', async () => {
    const broken = file('a,b')
    broken.text = () => Promise.reject(new Error('gone'))

    expect(await readImportFile(broken)).toEqual({ error: 'Could not read that file' })
  })
})
