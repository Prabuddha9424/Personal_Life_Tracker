import { describe, expect, it } from 'vitest'
import { MIN_GAP, POSITION_STEP, positionBetween } from './task.ordering.ts'

describe('positionBetween', () => {
  it('starts an empty column at 0', () => {
    expect(positionBetween(undefined, undefined)).toBe(0)
  })

  it('goes one step above the first card when dropped at the top', () => {
    expect(positionBetween(undefined, 10)).toBe(10 - POSITION_STEP)
  })

  it('goes one step below the last card when dropped at the bottom', () => {
    expect(positionBetween(10, undefined)).toBe(10 + POSITION_STEP)
  })

  it('takes the midpoint between two cards', () => {
    expect(positionBetween(0, 1024)).toBe(512)
    expect(positionBetween(-1024, 0)).toBe(-512)
  })

  it('asks for a rebalance when the gap is too small to split', () => {
    expect(positionBetween(1, 1 + MIN_GAP / 2)).toBeNull()
    expect(positionBetween(5, 5)).toBeNull()
  })

  it('still splits a gap that is just large enough', () => {
    const position = positionBetween(0, MIN_GAP * 4)

    expect(position).not.toBeNull()
    expect(position).toBeGreaterThan(0)
    expect(position).toBeLessThan(MIN_GAP * 4)
  })
})
