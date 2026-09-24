/** Distance between cards when a column is (re)numbered, and the offset for top and bottom drops. */
export const POSITION_STEP = 1024

/** Below this gap two positions can no longer be split reliably as floating-point numbers. */
export const MIN_GAP = 1e-6

/**
 * The position for a card dropped between `above` and `below` (either may be missing when the
 * card goes to the top, the bottom, or an empty column). `position` is an ordering key, not money.
 * Returns null when the caller must renumber the column and try again: both neighbours are given
 * but too close to split, out of order, or a neighbour is not a finite number, or the result
 * cannot be told apart from a neighbour at floating-point resolution.
 */
export function positionBetween(
  above: number | undefined,
  below: number | undefined,
): number | null {
  if (above !== undefined && !Number.isFinite(above)) return null
  if (below !== undefined && !Number.isFinite(below)) return null

  if (above === undefined) {
    if (below === undefined) return 0
    const position = below - POSITION_STEP
    return position < below ? position : null
  }
  if (below === undefined) {
    const position = above + POSITION_STEP
    return position > above ? position : null
  }

  if (below - above < MIN_GAP) return null
  const position = (above + below) / 2
  return position > above && position < below ? position : null
}
