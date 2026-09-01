/** Pixels within which a dragged divider jumps to a parallel divider elsewhere in the layout. */
export const SPLIT_RESIZE_SNAP_PX = 6;

/**
 * Pulls a drag distance onto the nearest parallel divider so grids line up.
 *
 * `snapOffsets` are the distances from this divider to every other divider on the same axis,
 * measured once when the drag starts. Snapping on the raw pointer distance rather than
 * accumulating per move keeps the divider pinned while the pointer stays inside the threshold
 * and releases it the moment the pointer leaves, with no hysteresis state to carry.
 */
export function snapResizeDelta(
  rawDelta: number,
  snapOffsets: number[],
  threshold = SPLIT_RESIZE_SNAP_PX,
): number {
  let snapped = rawDelta;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const offset of snapOffsets) {
    const distance = Math.abs(offset - rawDelta);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      snapped = offset;
    }
  }
  return snapped;
}
