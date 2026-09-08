import { basename } from "node:path";

import { createRealpathAwarePathMatcher } from "../../../utils/path.js";
import { runGitCommand } from "../../../utils/run-git-command.js";
import {
  createWorktree,
  isPaseoOwnedWorktreeCwd,
  mapWorkspaceCwdToWorktree,
  rollbackCreatedPaseoWorktree,
} from "../../../utils/worktree.js";
import { WorktreeRequestError, toWorktreeRequestError } from "../../worktree-errors.js";
import {
  resolveWorkspaceDisplayName,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type PersistedWorkspaceMember,
} from "../../workspace-registry.js";

export type WorkspaceRecoveryAction = "unarchive" | "restore";

export type WorkspaceRecoveryState =
  | {
      kind: "recoverable";
      workspaceId: string;
      workspaceName: string;
      action: WorkspaceRecoveryAction;
      branch: string | null;
    }
  | {
      kind: "unavailable";
      workspaceId: string;
      reason:
        | "workspace_not_found"
        | "workspace_not_archived"
        | "project_not_found"
        | "project_directory_missing"
        | "workspace_directory_missing"
        | "worktree_branch_missing";
      message: string;
    };

export interface WorkspaceRecoveryService {
  inspect(workspaceId: string): Promise<WorkspaceRecoveryState>;
  restore(workspaceId: string): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }>;
}

interface RecoveryPlan {
  kind: WorkspaceRecoveryAction;
  state: Extract<WorkspaceRecoveryState, { kind: "recoverable" }>;
  workspace: PersistedWorkspaceRecord;
  restores: Array<{ member: PersistedWorkspaceMember; sourceRepoRoot: string }>;
}

type UnavailableRecoveryState = Extract<WorkspaceRecoveryState, { kind: "unavailable" }>;

export function createWorkspaceRecoveryService(deps: {
  paseoHome: string;
  worktreesRoot?: string;
  getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
  getProject: (projectId: string) => Promise<PersistedProjectRecord | null>;
  isDirectory: (path: string) => Promise<boolean>;
  unarchiveWorkspace: (workspace: PersistedWorkspaceRecord) => Promise<void>;
}): WorkspaceRecoveryService {
  async function resolveRecovery(
    workspaceId: string,
  ): Promise<UnavailableRecoveryState | RecoveryPlan> {
    const workspace = await deps.getWorkspace(workspaceId);
    if (!workspace) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "workspace_not_found",
        message: "This workspace is no longer known to the host.",
      };
    }
    if (!workspace.archivedAt) {
      return {
        kind: "unavailable",
        workspaceId,
        reason: "workspace_not_archived",
        message: "This workspace is not archived, but it is unavailable from the host.",
      };
    }

    const restores: RecoveryPlan["restores"] = [];
    for (const member of workspace.members) {
      if (await deps.isDirectory(member.cwd)) continue;
      if (member.kind !== "worktree") {
        return {
          kind: "unavailable",
          workspaceId,
          reason: "workspace_directory_missing",
          message: `The project directory ${member.cwd} no longer exists and cannot be recreated.`,
        };
      }
      if (!member.branch) {
        return {
          kind: "unavailable",
          workspaceId,
          reason: "worktree_branch_missing",
          message: "The archived worktree has no branch recorded, so it cannot be restored.",
        };
      }
      const project = await deps.getProject(member.projectId);
      if (!project) {
        return {
          kind: "unavailable",
          workspaceId,
          reason: "project_not_found",
          message: "The project for this archived worktree no longer exists.",
        };
      }
      const sourceRepoRoot = member.mainRepoRoot ?? project.rootPath;
      if (!(await deps.isDirectory(sourceRepoRoot))) {
        return {
          kind: "unavailable",
          workspaceId,
          reason: "project_directory_missing",
          message: "The source repository needed to restore this worktree no longer exists.",
        };
      }
      restores.push({ member, sourceRepoRoot });
    }
    const action = restores.length > 0 ? "restore" : "unarchive";
    return {
      kind: action,
      workspace,
      restores,
      state: {
        kind: "recoverable",
        workspaceId,
        workspaceName: resolveWorkspaceDisplayName(workspace),
        action,
        branch: workspace.members.length === 1 ? workspace.members[0]!.branch : null,
      },
    };
  }

  async function inspect(workspaceId: string): Promise<WorkspaceRecoveryState> {
    const resolved = await resolveRecovery(workspaceId);
    return resolved.kind === "unavailable" ? resolved : resolved.state;
  }

  async function restore(
    workspaceId: string,
  ): Promise<{ workspaceId: string; action: WorkspaceRecoveryAction }> {
    const resolved = await resolveRecovery(workspaceId);
    if (resolved.kind === "unavailable") {
      throw new Error(resolved.message);
    }

    for (const { member, sourceRepoRoot } of resolved.restores) {
      // Another member may share the worktree restored by the previous entry.
      if (!(await deps.isDirectory(member.cwd)))
        await recreateArchivedWorktree(member, sourceRepoRoot);
    }
    await deps.unarchiveWorkspace(resolved.workspace);
    return { workspaceId, action: resolved.kind };
  }

  async function recreateArchivedWorktree(
    workspace: PersistedWorkspaceMember,
    sourceRepoRoot: string,
  ): Promise<void> {
    const branch = workspace.branch;
    if (!branch) {
      throw new WorktreeRequestError({
        code: "unknown",
        message: `Worktree ${workspace.cwd} has no branch to restore`,
      });
    }

    try {
      await runGitCommand(["worktree", "prune"], { cwd: sourceRepoRoot, timeout: 30_000 });
    } catch {
      // A stale worktree registration is not guaranteed; creation reports any real conflict.
    }

    let previousWorktreePath = workspace.worktreeRoot;
    if (!previousWorktreePath) {
      // COMPAT(worktreeRestoreMissingWorktreeRoot): records created before v0.1.110
      // lack durable backing placement; remove filesystem discovery after 2027-01-17.
      const ownership = await isPaseoOwnedWorktreeCwd(workspace.cwd, {
        paseoHome: deps.paseoHome,
        worktreesRoot: deps.worktreesRoot,
      });
      previousWorktreePath = ownership.allowed
        ? (ownership.worktreePath ?? workspace.cwd)
        : workspace.cwd;
    }

    let recreatedWorktreePath: string;
    try {
      const result = await createWorktree({
        cwd: sourceRepoRoot,
        worktreeSlug: basename(previousWorktreePath),
        source: { kind: "checkout-branch", branchName: branch },
        runSetup: false,
        paseoHome: deps.paseoHome,
        worktreesRoot: deps.worktreesRoot,
      });
      recreatedWorktreePath = result.worktreePath;
    } catch (error) {
      throw toWorktreeRequestError(error);
    }

    try {
      const recreatedWorkspacePath = mapWorkspaceCwdToWorktree({
        sourceWorktreePath: previousWorktreePath,
        workspaceCwd: workspace.cwd,
        targetWorktreePath: recreatedWorktreePath,
      });
      if (!createRealpathAwarePathMatcher(workspace.cwd)(recreatedWorkspacePath)) {
        throw new WorktreeRequestError({
          code: "unknown",
          message: `Recreated worktree diverged from ${workspace.cwd}: ${recreatedWorkspacePath}`,
        });
      }
      if (!(await deps.isDirectory(recreatedWorkspacePath))) {
        throw new WorktreeRequestError({
          code: "unknown",
          message: `Selected project directory is missing from the restored worktree: ${recreatedWorkspacePath}`,
        });
      }
    } catch (error) {
      return rollbackCreatedPaseoWorktree(
        {
          cwd: sourceRepoRoot,
          worktreePath: recreatedWorktreePath,
          teardownCwds: [],
          paseoHome: deps.paseoHome,
          worktreesBaseRoot: deps.worktreesRoot,
        },
        error,
      );
    }
  }

  return { inspect, restore };
}
