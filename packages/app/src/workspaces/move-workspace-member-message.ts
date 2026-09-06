/**
 * Turns a daemon refusal into something the user can act on. A move is refused when the
 * project is already a member of the target or the source no longer holds it; anything
 * else is surfaced verbatim because the daemon message already names the workspace.
 */
export function moveWorkspaceMemberErrorMessage(input: {
  errorCode: string | null;
  error: string | null;
  projectName: string;
  targetTitle: string;
}): string {
  if (input.errorCode === "duplicate_member") {
    return `"${input.projectName}" is already part of "${input.targetTitle}".`;
  }
  if (input.errorCode === "member_not_found") {
    return `"${input.projectName}" is no longer part of the source workspace.`;
  }
  if (input.errorCode === "workspace_not_found" || input.errorCode === "archived_workspace") {
    return "That workspace is no longer available.";
  }
  if (input.errorCode === "cross_host") {
    return "Projects can only move between workspaces on the same host.";
  }
  return input.error ?? `Could not move "${input.projectName}".`;
}
