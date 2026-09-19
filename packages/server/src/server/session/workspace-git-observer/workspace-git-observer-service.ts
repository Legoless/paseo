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

type WorkspaceGitObservationMember = Pick<
  NonNullable<WorkspaceDescriptorPayload["members"]>[number],
  "workspaceDirectory" | "workspaceKind"
> & { branch?: string | null };

type WorkspaceGitObservationTarget = Pick<
  WorkspaceDescriptorPayload,
  "id" | "workspaceDirectory" | "workspaceKind"
> & {
  members?: WorkspaceGitObservationMember[];
};

/** Each member directory shares one Git watch across its workspace containers. */
export interface WorkspaceGitObserverService {
  syncObservers(workspaces: Iterable<WorkspaceGitObservationTarget>): void;
  reconcileObservers(workspaces: Iterable<WorkspaceGitObservationTarget>): void;
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
  describeWorkspaceRecordWithGitData?: (
    workspace: PersistedWorkspaceRecord,
  ) => Promise<WorkspaceDescriptorPayload>;
  emitWorkspaceUpdateForCwd: (cwd: string) => Promise<void>;
  emitWorkspaceUpdateForWorkspaceId?: (workspaceId: string) => Promise<void>;
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
  const lastBranchByWorkspaceId = new Map<string, string | null>();

  function descriptorStateKey(workspace: WorkspaceDescriptorPayload | null): string {
    return workspace
      ? JSON.stringify([workspace.name, workspace.members, workspace.diffStat])
      : "__removed__";
  }

  function memberWatchTargets(workspace: WorkspaceGitObservationTarget): Array<{
    cwd: string;
    branch: string | null;
  }> {
    const members = workspace.members ?? [];
    if (members.length > 0) {
      return members
        .filter((member) => member.workspaceKind !== "directory")
        .map((member) => ({
          cwd: resolve(member.workspaceDirectory),
          branch: member.branch ?? null,
        }));
    }
    if (!workspace.workspaceDirectory || workspace.workspaceKind === "directory") return [];
    return [{ cwd: resolve(workspace.workspaceDirectory), branch: null }];
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
    lastBranchByWorkspaceId.delete(workspaceId);
  }

  function handleBranchSnapshot(cwd: string, branchName: string | null): void {
    const target = targets.get(resolve(cwd));
    if (!target || target.branch === branchName) return;
    const previous = target.branch;
    target.branch = branchName;
    for (const workspaceId of target.workspaceIds) {
      lastBranchByWorkspaceId.set(workspaceId, branchName);
      onBranchChanged?.(workspaceId, previous, branchName);
    }
  }

  function rememberDescriptorState(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): void {
    const currentBranch = workspace?.gitRuntime?.currentBranch;
    if (currentBranch === undefined) return;
    lastBranchByWorkspaceId.set(workspaceId, currentBranch);
  }

  function syncObservers(workspaces: Iterable<WorkspaceGitObservationTarget>): void {
    for (const workspace of workspaces) {
      const desiredMembers = memberWatchTargets(workspace);
      const desired = new Set(desiredMembers.map((member) => member.cwd));
      for (const cwd of workspaceDirectories.get(workspace.id) ?? []) {
        if (!desired.has(cwd)) release(cwd, workspace.id);
      }
      if (desired.size === 0) {
        removeForWorkspaceId(workspace.id);
        continue;
      }
      workspaceDirectories.set(workspace.id, desired);
      if (!lastBranchByWorkspaceId.has(workspace.id)) {
        lastBranchByWorkspaceId.set(workspace.id, null);
      }
      for (const member of desiredMembers) {
        const existing = targets.get(member.cwd);
        if (existing) {
          existing.workspaceIds.add(workspace.id);
          continue;
        }
        try {
          const target = {
            workspaceIds: new Set([workspace.id]),
            unsubscribe: () => {},
            branch: member.branch,
          };
          targets.set(member.cwd, target);
          const subscription = workspaceGitService.registerWorkspace(
            { cwd: member.cwd },
            (snapshot) => {
              handleBranchSnapshot(member.cwd, snapshot.git.currentBranch ?? null);
              void emitWorkspaceUpdateForCwd(member.cwd).catch((error) =>
                logger.warn(
                  { err: error, cwd: member.cwd },
                  "Failed to emit workspace update after git snapshot",
                ),
              );
              emitStatusUpdate(member.cwd, snapshot);
            },
          );
          target.unsubscribe = subscription.unsubscribe;
        } catch (error) {
          targets.delete(member.cwd);
          desired.delete(member.cwd);
          logger.warn(
            { err: error, cwd: member.cwd },
            "Failed to watch workspace member directory",
          );
        }
      }
      if ("name" in workspace) {
        descriptorKeys.set(
          workspace.id,
          descriptorStateKey(workspace as WorkspaceDescriptorPayload),
        );
      }
      rememberDescriptorState(workspace.id, workspace as WorkspaceDescriptorPayload);
    }
  }

  async function syncObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    if (!describeWorkspaceRecordWithGitData) return;
    syncObservers([await describeWorkspaceRecordWithGitData(workspace)]);
  }

  return {
    reconcileObservers(workspaces) {
      const retained = new Map([...workspaces].map((workspace) => [workspace.id, workspace]));
      const staleWorkspaceIds: string[] = [];
      for (const workspaceId of workspaceDirectories.keys()) {
        if (!retained.has(workspaceId)) staleWorkspaceIds.push(workspaceId);
      }
      for (const workspaceId of staleWorkspaceIds) removeForWorkspaceId(workspaceId);
      syncObservers(retained.values());
    },
    syncObservers,
    syncObserverForWorkspace,
    async warmGitData(workspace) {
      await syncObserverForWorkspace(workspace);
      if (emitWorkspaceUpdateForWorkspaceId)
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
      const newBranchName = workspace?.gitRuntime?.currentBranch;
      if (newBranchName !== undefined && lastBranchByWorkspaceId.has(workspaceId)) {
        const previous = lastBranchByWorkspaceId.get(workspaceId) ?? null;
        if (onBranchChanged && newBranchName !== previous) {
          onBranchChanged(workspaceId, previous, newBranchName);
        }
        rememberDescriptorState(workspaceId, workspace);
      }
      if (!workspaceDirectories.has(workspaceId)) return;
      descriptorKeys.set(workspaceId, descriptorStateKey(workspace));
      if (newBranchName !== undefined) return;
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
      lastBranchByWorkspaceId.clear();
    },
  };
}
