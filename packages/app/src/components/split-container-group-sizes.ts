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
