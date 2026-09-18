/**
 * Chooses between a group's persisted resize overrides and the sizes carried by the layout tree.
 *
 * The override is stored per group id in `splitSizesByWorkspace` and survives structural edits,
 * so a group that gains or loses a child can be left holding an array of the previous length.
 * A short array is worse than no array: `resolveVisibleGroupFlex` defaults a missing entry to 1,
 * which hands the unlisted child a full flex unit — roughly half the group — and leaves the
 * resize handle beside it writing to an index that does not exist, so that pane cannot be
 * resized at all. Length is the only signal that an override still describes this group.
 */
export function resolveGroupSizes(input: {
  storedSizes: number[] | undefined;
  structuralSizes: number[];
  childCount: number;
}): number[] {
  const { storedSizes, structuralSizes, childCount } = input;
  if (storedSizes && storedSizes.length === childCount) {
    return storedSizes;
  }
  return structuralSizes;
}

/**
 * Settled split flex has to live on the React style, not only on a Reanimated
 * `flexGrow` worklet. The worklet reads a shared array by index, and Reanimated 4
 * does not always flush that after a window resize or a committed drag — Unistyles
 * then rewrites the view without `flexGrow`, so the pane keeps its old size.
 */
export function resolveSplitGroupChildStyle(input: { hidden: boolean; flexGrow: number }): {
  flexGrow: number;
  flexShrink: number;
  flexBasis: 0;
  width?: 0;
  height?: 0;
} {
  if (input.hidden) {
    return { flexGrow: 0, flexShrink: 0, flexBasis: 0, width: 0, height: 0 };
  }
  return { flexGrow: input.flexGrow, flexShrink: 1, flexBasis: 0 };
}
