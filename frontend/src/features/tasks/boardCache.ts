import type { InfiniteData } from '@tanstack/react-query'
import type { Task, TaskPage } from './types'

export type ColumnData = InfiniteData<TaskPage, number>

export function flattenColumn(data: ColumnData | undefined): Task[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

/** Removes a card from whichever loaded page holds it. Page parameters are left untouched. */
export function removeTask(data: ColumnData, taskId: string): ColumnData {
  if (!data.pages.some((page) => page.items.some((item) => item.id === taskId))) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== taskId),
      total: page.total - 1,
    })),
  }
}

/**
 * Inserts a card at `index` counted across all loaded pages. Cards are edited in place per page
 * rather than merged into one page, so `pageParams` still lets a refetch reload every page.
 */
export function insertTask(data: ColumnData, task: Task, index: number): ColumnData {
  const pages = data.pages.map((page) => ({
    ...page,
    items: [...page.items],
    total: page.total + 1,
  }))
  let remaining = Math.max(0, index)

  for (const [position, page] of pages.entries()) {
    const isLastPage = position === pages.length - 1
    if (remaining < page.items.length || (remaining === page.items.length && isLastPage)) {
      page.items.splice(remaining, 0, task)
      break
    }
    remaining -= page.items.length
  }
  return { ...data, pages }
}

/**
 * The cards that will sit directly above and below a dropped card, ignoring the card itself.
 * `destIndex` is the final index in the destination list, which is what the drag library reports.
 * Both neighbours are returned whenever they exist: the server does not verify that a one-sided
 * drop is really at the edge, so only a real edge may omit one.
 */
export function neighboursFor(
  items: Task[],
  movedId: string,
  destIndex: number,
): { afterId: string | undefined; beforeId: string | undefined } {
  const others = items.filter((item) => item.id !== movedId)
  return { afterId: others[destIndex - 1]?.id, beforeId: others[destIndex]?.id }
}
