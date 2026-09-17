import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type PaneStatusGlowBucket = Exclude<SidebarStateBucket, "done">;

export interface PaneStatusGlowInput {
  bucket: SidebarStateBucket | null;
  /**
   * True once the agent has been given work (a user prompt). Drafts and agents
   * that were never started stay unadorned even though their lifecycle bucket
   * is `done`.
   */
  hasStarted?: boolean;
}

/**
 * Pane glow uses the tab/sidebar status colors, with one extra idle rule: a
 * started agent that is idle again is green (ready for the next task), even
 * after finished attention has been cleared. Never-started agents stay dark.
 *
 * - `running` — blue; the agent is working
 * - `needs_input` — orange; the agent is blocked on the user
 * - `failed` — red; error or quota
 * - `attention` or started `done` — green; finished and ready for the next task
 */
export function resolvePaneStatusGlowBucket(
  input: PaneStatusGlowInput,
): PaneStatusGlowBucket | null {
  const { bucket, hasStarted = false } = input;
  if (
    bucket === "running" ||
    bucket === "needs_input" ||
    bucket === "failed" ||
    bucket === "attention"
  ) {
    return bucket;
  }
  if (bucket === "done" && hasStarted) {
    return "attention";
  }
  return null;
}
