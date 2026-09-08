import { resolve } from "node:path";
import type pino from "pino";
import type { WorkspaceDescriptorPayload } from "../../messages.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "../../workspace-git-service.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";

export interface WorkspaceGitObserverMetrics {
  watchedDirectoryCount: number;
  workspaceRecordCount: number;
  subscriptionCount: number;
}

/** Each member directory shares one Git watch across its workspace containers. */
export interface WorkspaceGitObserverService {
  syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void;
  syncObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void>;
  warmGitData(workspace: PersistedWorkspaceRecord): Promise<void>;
  // Check-and-record dedupe gate: returns true when the descriptor state is unchanged
  // for this workspace, and otherwise advances the recorded state key as a side effect.
  shouldSkipUpdate(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): boolean;
  recordDescriptorState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void;
  handleBranchSnapshot(cwd: string, branchName: string | null): void;
  getMetrics(): WorkspaceGitObserverMetrics;
  removeForWorkspaceId(workspaceId: string): void;
  dispose(): void;
}

export function createWorkspaceGitObserverService(deps: {
  workspaceGitService: Pick<WorkspaceGitService, "registerWorkspace">;
  describeWorkspaceRecordWithGitData: (
    workspace: PersistedWorkspaceRecord,
  ) => Promise<WorkspaceDescriptorPayload>;
  emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  emitStatusUpdate: (cwd: string, snapshot: WorkspaceGitRuntimeSnapshot) => void;
  onBranchChanged?: (
    workspaceId: string,
    oldBranch: string | null,
    newBranch: string | null,
  ) => void;
  logger: pino.Logger;
}): WorkspaceGitObserverService {
  const {
    workspaceGitService,
    describeWorkspaceRecordWithGitData,
    emitWorkspaceUpdateForCwd,
    emitWorkspaceUpdateForWorkspaceId,
    emitStatusUpdate,
    onBranchChanged,
    logger,
  } = deps;

  const targets = new Map<
    string,
    { workspaceIds: Set<string>; unsubscribe: () => void; branch: string | null }
  >();
  const workspaceDirectories = new Map<string, Set<string>>();
  const descriptorKeys = new Map<string, string>();

  function descriptorStateKey(workspace: WorkspaceDescriptorPayload | null): string {
    return workspace
      ? JSON.stringify([workspace.name, workspace.members, workspace.diffStat])
      : "__removed__";
  }

  function release(cwd: string, workspaceId: string): void {
    const target = targets.get(cwd);
    if (!target) return;
    target.workspaceIds.delete(workspaceId);
    if (target.workspaceIds.size === 0) {
      target.unsubscribe();
      targets.delete(cwd);
    }
  }

  function removeForWorkspaceId(workspaceId: string): void {
    for (const cwd of workspaceDirectories.get(workspaceId) ?? []) release(cwd, workspaceId);
    workspaceDirectories.delete(workspaceId);
    descriptorKeys.delete(workspaceId);
  }

  function handleBranchSnapshot(cwd: string, branchName: string | null): void {
    const target = targets.get(resolve(cwd));
    if (!target || target.branch === branchName) return;
    const previous = target.branch;
    target.branch = branchName;
    for (const workspaceId of target.workspaceIds)
      onBranchChanged?.(workspaceId, previous, branchName);
  }

  function syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void {
    for (const workspace of workspaces) {
      const desired = new Set(
        (workspace.members ?? [])
          .filter((member) => member.workspaceKind !== "directory")
          .map((member) => resolve(member.workspaceDirectory)),
      );
      for (const cwd of workspaceDirectories.get(workspace.id) ?? []) {
        if (!desired.has(cwd)) release(cwd, workspace.id);
      }
      if (desired.size === 0) {
        removeForWorkspaceId(workspace.id);
        continue;
      }
      workspaceDirectories.set(workspace.id, desired);
      for (const cwd of desired) {
        const existing = targets.get(cwd);
        if (existing) {
          existing.workspaceIds.add(workspace.id);
          continue;
        }
        try {
          const target = {
            workspaceIds: new Set([workspace.id]),
            unsubscribe: () => {},
            branch:
              workspace.members?.find((member) => resolve(member.workspaceDirectory) === cwd)
                ?.branch ?? null,
          };
          targets.set(cwd, target);
          const subscription = workspaceGitService.registerWorkspace({ cwd }, (snapshot) => {
            handleBranchSnapshot(cwd, snapshot.git.currentBranch ?? null);
            void emitWorkspaceUpdateForCwd(cwd).catch((error) =>
              logger.warn(
                { err: error, cwd },
                "Failed to emit workspace update after git snapshot",
              ),
            );
            emitStatusUpdate(cwd, snapshot);
          });
          target.unsubscribe = subscription.unsubscribe;
        } catch (error) {
          targets.delete(cwd);
          desired.delete(cwd);
          logger.warn({ err: error, cwd }, "Failed to watch workspace member directory");
        }
      }
      descriptorKeys.set(workspace.id, descriptorStateKey(workspace));
    }
  }

  async function syncObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    syncObservers([await describeWorkspaceRecordWithGitData(workspace)]);
  }

  return {
    syncObservers,
    syncObserverForWorkspace,
    async warmGitData(workspace) {
      await syncObserverForWorkspace(workspace);
      await emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
    },
    shouldSkipUpdate(workspaceId, workspace) {
      if (!workspaceDirectories.has(workspaceId)) return false;
      const key = descriptorStateKey(workspace);
      if (descriptorKeys.get(workspaceId) === key) return true;
      descriptorKeys.set(workspaceId, key);
      return false;
    },
    recordDescriptorState(workspaceId, workspace) {
      if (!workspaceDirectories.has(workspaceId)) return;
      descriptorKeys.set(workspaceId, descriptorStateKey(workspace));
      for (const member of workspace?.members ?? []) {
        if (member.branch !== undefined)
          handleBranchSnapshot(member.workspaceDirectory, member.branch);
      }
    },
    handleBranchSnapshot,
    getMetrics() {
      return {
        watchedDirectoryCount: targets.size,
        workspaceRecordCount: workspaceDirectories.size,
        subscriptionCount: targets.size,
      };
    },
    removeForWorkspaceId,
    dispose() {
      for (const target of targets.values()) target.unsubscribe();
      targets.clear();
      workspaceDirectories.clear();
      descriptorKeys.clear();
    },
  };
}
