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
