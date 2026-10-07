import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import {
  deriveSidebarStateBucket,
  type SidebarAttentionReason,
  type SidebarStateBucket,
} from "@/utils/sidebar-agent-state";

/**
 * A titleless agent has nothing to show yet, so the tab shimmers until the title
 * lands. Anything the daemon does hold is the user's to read back verbatim —
 * including "New Agent", which the rename modal accepts like any other name.
 */
export function resolveWorkspaceAgentTabLabel(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  return normalized ? normalized : null;
}

export interface AgentPanelStatusBucketInput {
  status: AgentLifecycleStatus | null;
  isTurnActive: boolean;
  pendingPermissionCount: number;
  backgroundWorkCount?: number;
  requiresAttention: boolean;
  attentionReason: SidebarAttentionReason;
  hasRunningChild: boolean;
}

/**
 * A running child is the parent's background work: an agent whose own turn closed keeps its tab
 * and pane `running` while the fan-out is unfinished, so the glow agrees with the subagents pill.
 * A pending permission or an unseen failure still outranks it.
 */
export function resolveAgentPanelStatusBucket(
  input: AgentPanelStatusBucketInput,
): SidebarStateBucket | null {
  if (!input.status) {
    return null;
  }
  return deriveSidebarStateBucket({
    status: input.isTurnActive ? "running" : input.status,
    pendingPermissionCount: input.pendingPermissionCount,
    backgroundWorkCount: Math.max(input.backgroundWorkCount ?? 0, input.hasRunningChild ? 1 : 0),
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
  });
}
