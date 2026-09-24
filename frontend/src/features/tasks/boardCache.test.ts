import { describe, expect, it } from 'vitest'
import { flattenColumn, insertTask, neighboursFor, removeTask, type ColumnData } from './boardCache'
import type { Task } from './types'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    tags: [],
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Two loaded pages of two cards each, out of 5 in the column. */
function twoPages(): ColumnData {
  return {
    pageParams: [1, 2],
    pages: [
      { items: [task('a'), task('b')], page: 1, limit: 2, total: 5 },
      { items: [task('c'), task('d')], page: 2, limit: 2, total: 5 },
    ],
  }
}

const ids = (data: ColumnData) => flattenColumn(data).map((t) => t.id)

describe('flattenColumn', () => {
  it('joins the loaded pages, and copes with no data', () => {
    expect(ids(twoPages())).toEqual(['a', 'b', 'c', 'd'])
    expect(flattenColumn(undefined)).toEqual([])
  })
})

describe('removeTask', () => {
  it('removes the card from whichever page holds it and lowers the total', () => {
    const result = removeTask(twoPages(), 'c')

    expect(ids(result)).toEqual(['a', 'b', 'd'])
    expect(result.pages.map((p) => p.total)).toEqual([4, 4])
    expect(result.pageParams).toEqual([1, 2])
  })

  it('leaves the data alone when the card is not loaded', () => {
    const data = twoPages()

    expect(removeTask(data, 'zzz')).toBe(data)
  })
})

describe('insertTask', () => {
  it.each([
    [0, ['x', 'a', 'b', 'c', 'd']],
    [1, ['a', 'x', 'b', 'c', 'd']],
    [2, ['a', 'b', 'x', 'c', 'd']],
    [3, ['a', 'b', 'c', 'x', 'd']],
    [4, ['a', 'b', 'c', 'd', 'x']],
  ])('inserts at flat index %i', (index, expected) => {
    const result = insertTask(twoPages(), task('x'), index)

    expect(ids(result)).toEqual(expected)
    expect(result.pages.map((p) => p.total)).toEqual([6, 6])
  })

  it('appends when the index is past the end instead of dropping the card', () => {
    const result = insertTask(twoPages(), task('x'), 9)

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd', 'x'])
    expect(result.pages.map((p) => p.total)).toEqual([6, 6])
  })

  it('returns the data unchanged, total included, when no page is loaded', () => {
    const none: ColumnData = { pageParams: [], pages: [] }

    expect(insertTask(none, task('x'), 0)).toBe(none)
  })

  it('does not change the page parameters, so a refetch still asks for every page', () => {
    expect(insertTask(twoPages(), task('x'), 1).pageParams).toEqual([1, 2])
  })

  it('inserts into an empty column', () => {
    const empty: ColumnData = {
      pageParams: [1],
      pages: [{ items: [], page: 1, limit: 50, total: 0 }],
    }

    expect(ids(insertTask(empty, task('x'), 0))).toEqual(['x'])
  })

  it('does not mutate its input', () => {
    const data = twoPages()

    insertTask(data, task('x'), 1)

    expect(ids(data)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('neighboursFor', () => {
  const items = [task('a'), task('b'), task('c')]

  it('names the cards that will sit above and below the drop position', () => {
    expect(neighboursFor(items, 'x', 1)).toEqual({ afterId: 'a', beforeId: 'b' })
    expect(neighboursFor(items, 'x', 2)).toEqual({ afterId: 'b', beforeId: 'c' })
  })

  it('returns both neighbours in the middle of a column, never just one', () => {
    // The server does not check that a one-sided drop is really at the edge, so a middle drop
    // must always carry both ids.
    const result = neighboursFor([task('a'), task('b'), task('c'), task('d'), task('e')], 'x', 2)

    expect(result.afterId).toBe('b')
    expect(result.beforeId).toBe('c')
  })

  it('has no card above at the top and none below at the bottom', () => {
    expect(neighboursFor(items, 'x', 0)).toEqual({ afterId: undefined, beforeId: 'a' })
    expect(neighboursFor(items, 'x', 3)).toEqual({ afterId: 'c', beforeId: undefined })
  })

  it('ignores the moved card itself when it is reordered inside its own column', () => {
    // Dragging "a" to the end of [a, b, c]: the final list is [b, c, a], so index 2 is "after c".
    expect(neighboursFor(items, 'a', 2)).toEqual({ afterId: 'c', beforeId: undefined })
    // Dragging "c" to the top.
    expect(neighboursFor(items, 'c', 0)).toEqual({ afterId: undefined, beforeId: 'a' })
  })

  it('counts the destination index after the moved card is removed from its own column', () => {
    // Dragging "a" from [a, b, c, d] to final index 1 gives [b, a, c, d]: b above, c below.
    const four = [task('a'), task('b'), task('c'), task('d')]

    expect(neighboursFor(four, 'a', 1)).toEqual({ afterId: 'b', beforeId: 'c' })
    // Dragging "d" up to final index 2 gives [a, b, d, c]: b above, c below.
    expect(neighboursFor(four, 'd', 2)).toEqual({ afterId: 'b', beforeId: 'c' })
  })

  it('has no neighbours in an empty column', () => {
    expect(neighboursFor([], 'x', 0)).toEqual({ afterId: undefined, beforeId: undefined })
  })
})
