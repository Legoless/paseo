import type { WorkspaceDescriptor, WorkspaceMemberDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

type DiffStat = NonNullable<WorkspaceDescriptor["diffStat"]>;

export function useVisibleWorkspaceDiffStat(
  serverId: string,
  workspaceId: string,
): DiffStat | null {
  const diffStat = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.diffStat);
  return hasDiffStatChanges(diffStat) ? diffStat : null;
}

export function useWorkspaceHasDiffStat(serverId: string, workspaceId: string): boolean {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      hasDiffStatChanges(workspace.diffStat),
    ) ?? false
  );
}

/**
 * Resolve the diff stat for the workspace member whose `workspaceDirectory`
 * matches the given `cwd`. Falls back to the workspace-level aggregate when
 * no member match is found (single-member workspaces, legacy daemons).
 */
export function useVisibleMemberDiffStat(
  serverId: string,
  workspaceId: string,
  cwd: string,
): DiffStat | null {
  const diffStat = useWorkspaceFields(serverId, workspaceId, (workspace) =>
    resolveMemberDiffStat(workspace, cwd),
  );
  return hasDiffStatChanges(diffStat) ? diffStat : null;
}

export function useMemberHasDiffStat(serverId: string, workspaceId: string, cwd: string): boolean {
  return (
    useWorkspaceFields(serverId, workspaceId, (workspace) =>
      hasDiffStatChanges(resolveMemberDiffStat(workspace, cwd)),
    ) ?? false
  );
}

function resolveMemberDiffStat(
  workspace: WorkspaceDescriptor,
  cwd: string,
): WorkspaceMemberDescriptor["diffStat"] | null {
  if (workspace.members.length === 0) return workspace.diffStat;
  const normalizedCwd = normalizeWorkspacePath(cwd);
  if (!normalizedCwd) return workspace.diffStat;
  const member = workspace.members.find(
    (m) => normalizeWorkspacePath(m.workspaceDirectory) === normalizedCwd,
  );
  if (member) return member.diffStat ?? null;
  // If there's only one member, fall back to workspace diffStat (e.g. legacy daemons or root cwd)
  if (workspace.members.length === 1) return workspace.diffStat;
  // In a multi-member workspace, an agent whose cwd does not match any member has no diffStat
  return null;
}

function hasDiffStatChanges(
  diffStat: WorkspaceDescriptor["diffStat"] | WorkspaceMemberDescriptor["diffStat"],
): diffStat is DiffStat {
  return Boolean(diffStat && (diffStat.additions > 0 || diffStat.deletions > 0));
}
