import type { AgentStateBucketInput } from "@getpaseo/protocol/agent-state-bucket";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

/**
 * Attention accounting shared by the dock badge and the web favicon.
 *
 * The badge counts agents by the same bucket their tabs and sidebar rows are coloured with: waiting
 * on a permission, an error the user has not seen, or a finish the user has not seen. A running
 * agent is counted once it stops, not while its loader shows. It counts unread agents, not
 * glowing panes: a pane glows only for its front tab, so an unread tab behind it is counted
 * without lighting the pane.
 */
export type DesktopBadgeAgent = AgentStateBucketInput;

const BADGE_BUCKETS: ReadonlySet<SidebarStateBucket> = new Set([
  "needs_input",
  "failed",
  "attention",
]);

export function isAgentActionableForDesktopBadge(agent: DesktopBadgeAgent): boolean {
  return BADGE_BUCKETS.has(deriveSidebarStateBucket(agent));
}

export function deriveDockBadgeCountFromAgents(
  agents: readonly DesktopBadgeAgent[],
): number | undefined {
  const actionableCount = agents.filter(isAgentActionableForDesktopBadge).length;
  return actionableCount > 0 ? actionableCount : undefined;
}
