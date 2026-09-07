/**
 * Turns a daemon refusal into something the user can act on. An agent move is refused when
 * the target no longer holds the agent's project or the agent is already there; anything else
 * is surfaced verbatim because the daemon message already names what it could not do.
 */
export function moveAgentWorkspaceErrorMessage(input: {
  errorCode: string | null;
  error: string | null;
  agentTitle: string;
  targetTitle: string;
}): string {
  if (input.errorCode === "member_not_found") {
    return `"${input.targetTitle}" no longer has the project "${input.agentTitle}" runs in.`;
  }
  if (input.errorCode === "same_workspace") {
    return `"${input.agentTitle}" is already in "${input.targetTitle}".`;
  }
  if (input.errorCode === "agent_not_found") {
    return `"${input.agentTitle}" is no longer available.`;
  }
  if (input.errorCode === "workspace_not_found" || input.errorCode === "archived_workspace") {
    return "That workspace is no longer available.";
  }
  if (input.errorCode === "cross_host") {
    return "Agents can only move between workspaces on the same host.";
  }
  if (input.errorCode === "unsupported_host") {
    return "This host is too old to move an agent between workspaces. Update it and try again.";
  }
  return input.error ?? `Could not move "${input.agentTitle}".`;
}
