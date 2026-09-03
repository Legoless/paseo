import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

function archivedAgentsClause(agentCount: number): string {
  if (agentCount === 1) {
    return ", and its agent will be archived";
  }
  if (agentCount > 1) {
    return `, and its ${agentCount} agents will be archived`;
  }
  return "";
}

/**
 * The confirmation for removing a project from a workspace. Removing it archives whatever agents
 * are still sitting in that directory, so the count is named here rather than discovered afterwards
 * — the archive is the part of this the user cannot undo by re-adding the project.
 */
export function buildRemoveWorkspaceMemberDialog(input: {
  projectName: string;
  agentCount: number;
}): ConfirmDialogInput {
  const agents = archivedAgentsClause(input.agentCount);
  return {
    title: "Remove project from workspace?",
    message: `"${input.projectName}" will no longer be part of this workspace${agents}. Its directory stays on disk.`,
    confirmLabel: "Remove",
    destructive: true,
  };
}

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
