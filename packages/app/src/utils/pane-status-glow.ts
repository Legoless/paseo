import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type PaneStatusGlowBucket = Exclude<SidebarStateBucket, "done">;

/**
 * Pane glow uses the tab/sidebar status colors. Green is unseen finished attention, so it goes
 * dark once the user focuses the pane and attention clears.
 *
 * - `running` — blue; the agent is working
 * - `needs_input` — orange; the agent is blocked on the user
 * - `failed` — red; error or quota
 * - `attention` — green; finished and not yet seen
 */
export function resolvePaneStatusGlowBucket(
  bucket: SidebarStateBucket | null,
): PaneStatusGlowBucket | null {
  if (bucket === null || bucket === "done") {
    return null;
  }
  return bucket;
}
