import { describe, expect, it } from 'vitest'
import { planBatches } from './importBatches'
import type { TransactionInput } from './types'

function row(note: string): TransactionInput {
  return { kind: 'expense', amountMinor: 100, categoryId: 'e-other', date: '2026-09-01', note }
}

const bytesOf = (rows: TransactionInput[]) =>
  new TextEncoder().encode(JSON.stringify({ rows })).length

const CAP = 90 * 1024

describe('planBatches', () => {
  it('cuts ordinary rows into batches of 200 and remembers where each starts', () => {
    const rows = Array.from({ length: 450 }, (_, i) => row(`Item ${i}`))

    const batches = planBatches(rows)

    expect(batches.map((batch) => batch.rows.length)).toEqual([200, 200, 50])
    expect(batches.map((batch) => batch.start)).toEqual([0, 200, 400])
  })

  it.each([
    ['Sinhala', 'අ'.repeat(200)],
    ['emoji', '\u{1f600}'.repeat(100)],
    ['quotes', '"'.repeat(200)],
    ['control characters', '\u0001'.repeat(200)],
  ])('keeps a batch of %s notes under the byte cap', (_name, note) => {
    const rows = Array.from({ length: 600 }, () => row(note))

    const batches = planBatches(rows)

    expect(batches.length).toBeGreaterThan(3)
    for (const batch of batches) {
      expect(bytesOf(batch.rows)).toBeLessThanOrEqual(CAP)
      expect(batch.rows.length).toBeLessThanOrEqual(200)
    }
  })

  it('fills each batch as far as the cap allows', () => {
    const rows = Array.from({ length: 600 }, () => row('අ'.repeat(200)))

    const [first, second] = planBatches(rows)

    expect(bytesOf([...(first?.rows ?? []), row('අ'.repeat(200))])).toBeGreaterThan(CAP)
    expect(second?.start).toBe(first?.rows.length)
  })

  it('keeps every row, in order, exactly once', () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(`${'අ'.repeat(150)} ${i}`))

    const batches = planBatches(rows)

    expect(batches.flatMap((batch) => batch.rows)).toEqual(rows)
    let expected = 0
    for (const batch of batches) {
      expect(batch.start).toBe(expected)
      expected += batch.rows.length
    }
  })

  it('returns nothing for no rows', () => {
    expect(planBatches([])).toEqual([])
  })
})
