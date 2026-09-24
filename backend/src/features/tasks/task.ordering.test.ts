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

  it('asks for a rebalance when the neighbours are in the wrong order', () => {
    expect(positionBetween(10, 5)).toBeNull()
  })

  it('splits a gap of exactly MIN_GAP at zero magnitude', () => {
    expect(positionBetween(0, 1e-6)).toBe(5e-7)
  })

  it('asks for a rebalance when the midpoint rounds onto a neighbour', () => {
    expect(positionBetween(1e10, 1e10 + 1.9e-6)).toBeNull()
  })

  it('asks for a rebalance when a neighbour is not a finite number', () => {
    expect(positionBetween(Number.NaN, 1)).toBeNull()
    expect(positionBetween(1, Number.NaN)).toBeNull()
    expect(positionBetween(-Infinity, Infinity)).toBeNull()
    expect(positionBetween(0, Infinity)).toBeNull()
    expect(positionBetween(-Infinity, 0)).toBeNull()
    expect(positionBetween(Infinity, Infinity)).toBeNull()
  })

  it('asks for a rebalance when the only neighbour is not a finite number', () => {
    expect(positionBetween(undefined, Number.NaN)).toBeNull()
    expect(positionBetween(undefined, Infinity)).toBeNull()
    expect(positionBetween(undefined, -Infinity)).toBeNull()
    expect(positionBetween(Number.NaN, undefined)).toBeNull()
    expect(positionBetween(Infinity, undefined)).toBeNull()
    expect(positionBetween(-Infinity, undefined)).toBeNull()
  })

  it('asks for a rebalance when a one-sided drop cannot move past the neighbour', () => {
    expect(positionBetween(1e20, undefined)).toBeNull()
    expect(positionBetween(undefined, -1e20)).toBeNull()
  })
})
