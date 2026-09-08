/**
 * Attention accounting shared by the dock badge and the web favicon.
 *
 * Workspace status is not usable here: the daemon reports every workspace as
 * "done" (see `describeWorkspaceRecord` in packages/server/src/server/session.ts),
 * so a workspace-derived count is always zero. Agents carry the real signal —
 * `requiresAttention` is set for the "finished", "error" and "permission"
 * reasons, and pending permissions are counted separately for older daemons.
 */
export interface DesktopBadgeAgent {
  requiresAttention?: boolean;
  pendingPermissionCount?: number;
}

export function isAgentActionableForDesktopBadge(agent: DesktopBadgeAgent): boolean {
  return agent.requiresAttention === true || (agent.pendingPermissionCount ?? 0) > 0;
}

export function deriveDockBadgeCountFromAgents(
  agents: readonly DesktopBadgeAgent[],
): number | undefined {
  const actionableCount = agents.filter(isAgentActionableForDesktopBadge).length;
  return actionableCount > 0 ? actionableCount : undefined;
}
