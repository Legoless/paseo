/**
 * Folds a drag's new visible order back into the stored order without moving the rows a
 * filter is currently hiding. Only the slots the visible keys already occupy are rewritten,
 * so a hidden key keeps the neighbours it had — the same in-place substitution
 * `applyStoredOrdering` uses to read the order back. Appending the hidden keys instead
 * demoted every filtered-out row to the bottom on any drag.
 */
export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const visible = new Set(input.reorderedVisibleKeys);
  const merged: string[] = [];
  let nextVisible = 0;

  for (const key of input.currentOrder) {
    if (!visible.has(key)) {
      merged.push(key);
      continue;
    }
    const replacement = input.reorderedVisibleKeys[nextVisible];
    nextVisible += 1;
    if (replacement !== undefined) {
      merged.push(replacement);
    }
  }

  // Visible keys the stored order has never seen — a row dragged before its key was recorded.
  for (const key of input.reorderedVisibleKeys.slice(nextVisible)) {
    merged.push(key);
  }

  return merged;
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}

/**
 * Where a project lands in the target workspace's remembered order after a cross-workspace
 * move. The daemon appends the membership and knows nothing about sidebar order, and the
 * baseline sort is by project name, so without this the project lands wherever its name falls
 * rather than where the user dropped it.
 *
 * `baselineMemberKeys` seeds the order for a workspace that has never been dragged; a
 * `dropOnMemberKey` of null (a drop on the bare workspace row) appends.
 */
export function memberOrderAfterMove(input: {
  storedOrder: string[];
  baselineMemberKeys: string[];
  movedMemberKey: string;
  dropOnMemberKey: string | null;
}): string[] {
  const baseline = input.storedOrder.length > 0 ? input.storedOrder : input.baselineMemberKeys;
  const next = baseline.filter((key) => key !== input.movedMemberKey);
  const dropIndex = input.dropOnMemberKey === null ? -1 : next.indexOf(input.dropOnMemberKey);
  next.splice(dropIndex < 0 ? next.length : dropIndex, 0, input.movedMemberKey);
  return next;
}
