/**
 * Turns a daemon refusal into something the user can act on. The daemon guards a removal that would
 * orphan work: an agent or a terminal still sitting in the directory being removed, or the last
 * member, which would leave the workspace with no project at all.
 */
export function removeWorkspaceMemberErrorMessage(input: {
  errorCode: string | null;
  error: string | null;
  projectName: string;
}): string {
  if (input.errorCode === "member_has_active_agents") {
    return `"${input.projectName}" still has agents. Archive them, then remove the project.`;
  }
  if (input.errorCode === "member_has_live_terminals") {
    return `"${input.projectName}" still has a running terminal. Close it, then remove the project.`;
  }
  if (input.errorCode === "last_member") {
    return "A workspace keeps at least one project. Add another before removing this one.";
  }
  if (input.errorCode === "member_not_found") {
    return `"${input.projectName}" is not part of this workspace.`;
  }
  return input.error ?? "Could not remove the project from this workspace.";
}
