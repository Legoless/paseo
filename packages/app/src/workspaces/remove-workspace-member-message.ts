import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

function archivedAgentsClause(agentCount: number): string {
  if (agentCount === 1) {
    return ", and its agent will be closed";
  }
  if (agentCount > 1) {
    return `, and its ${agentCount} agents will be closed`;
  }
  return "";
}

/**
 * The confirmation for closing a project in a workspace. Closing it closes whatever agents
 * are still sitting in that directory, so the count is named here rather than discovered afterwards
 * — the close is the part of this the user cannot undo by re-adding the project.
 */
export function buildRemoveWorkspaceMemberDialog(input: {
  projectName: string;
  agentCount: number;
}): ConfirmDialogInput {
  const agents = archivedAgentsClause(input.agentCount);
  return {
    title: "Close project?",
    message: `"${input.projectName}" will no longer be part of this workspace${agents}. Its directory stays on disk.`,
    confirmLabel: "Close",
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
    return `"${input.projectName}" still has agents. Close them, then close the project.`;
  }
  if (input.errorCode === "member_has_live_terminals") {
    return `"${input.projectName}" still has a running terminal. Close it, then close the project.`;
  }
  if (input.errorCode === "last_member") {
    return "A workspace keeps at least one project. Add another before closing this one.";
  }
  if (input.errorCode === "member_not_found") {
    return `"${input.projectName}" is not part of this workspace.`;
  }
  return input.error ?? "Could not close the project.";
}
