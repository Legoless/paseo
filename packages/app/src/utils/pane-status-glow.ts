import { STATUS_BUCKET_ORDER, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

export type PaneStatusGlowBucket = Exclude<SidebarStateBucket, "done">;

interface PaneStatusGlowVisibilityInput {
  isTerminalTab: boolean;
  paneStatusGlowEnabled: boolean;
  terminalStatusGlowEnabled: boolean;
}

export function shouldShowPaneStatusGlow({
  isTerminalTab,
  paneStatusGlowEnabled,
  terminalStatusGlowEnabled,
}: PaneStatusGlowVisibilityInput): boolean {
  return paneStatusGlowEnabled && (!isTerminalTab || terminalStatusGlowEnabled);
}

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

export interface PaneTabStatus {
  bucket: SidebarStateBucket | null;
  active: boolean;
}

const UNREAD_BUCKETS: ReadonlySet<SidebarStateBucket> = new Set([
  "needs_input",
  "failed",
  "attention",
]);

/**
 * The pane shows its active tab's state, unless a tab behind it holds something the user has not
 * seen: the badge counts that agent, so the pane it sits in has to light up. What the user must act
 * on outranks what is still moving on its own.
 */
export function resolvePaneStatusBucket(tabs: readonly PaneTabStatus[]): SidebarStateBucket | null {
  const buckets = new Set(
    tabs.flatMap(({ bucket, active }) =>
      bucket && (active || UNREAD_BUCKETS.has(bucket)) ? [bucket] : [],
    ),
  );
  return STATUS_BUCKET_ORDER.find((bucket) => buckets.has(bucket)) ?? null;
}
