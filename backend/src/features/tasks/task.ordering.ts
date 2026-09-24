/** Distance between cards when a column is (re)numbered, and the offset for top and bottom drops. */
export const POSITION_STEP = 1024

/** Below this gap two positions can no longer be split reliably as floating-point numbers. */
export const MIN_GAP = 1e-6

/**
 * The position for a card dropped between `above` and `below` (either may be missing when the
 * card goes to the top, the bottom, or an empty column). `position` is an ordering key, not money.
 * Returns null when both neighbours are given but too close to split: the caller renumbers the
 * column and tries again.
 */
export function positionBetween(
  above: number | undefined,
  below: number | undefined,
): number | null {
  if (above === undefined && below === undefined) return 0
  if (above === undefined) return (below ?? 0) - POSITION_STEP
  if (below === undefined) return above + POSITION_STEP
  if (below - above < MIN_GAP) return null
  return (above + below) / 2
}
