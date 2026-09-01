import { resolve } from "node:path";
import type pino from "pino";
import type { WorkspaceDescriptorPayload } from "../../messages.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitService,
} from "../../workspace-git-service.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";

const WORKSPACE_GIT_WATCH_REMOVED_STATE_KEY = "__removed__";

interface WorkspaceGitWatchTarget {
  workspaceIds: Set<string>;
}

interface WorkspaceGitWatchState {
  cwd: string;
  latestDescriptorStateKey: string | null;
  lastBranchName: string | null;
}

export interface WorkspaceGitObserverMetrics {
  watchedDirectoryCount: number;
  workspaceRecordCount: number;
  subscriptionCount: number;
}

/**
 * Observes a workspace's git state on disk (via WorkspaceGitService) and drives the
 * live update fan-out: branch-change notifications, workspace-card refreshes, and
 * checkout status updates. It owns the per-cwd watch targets and the WorkspaceGitService
 * subscription handles. Filesystem subscriptions are keyed by cwd while descriptor and
 * branch state remain keyed by workspace id, so same-directory workspace records share one
 * watch without sharing identity or teardown lifetime.
 *
 * Branch changes reach `onBranchChanged` from two paths that share `lastBranchName`: the
 * on-disk snapshot listener (handleBranchSnapshot) and the workspace-emit loop's Git runtime
 * projection (recordDescriptorState). Both stay inside this module so the shared state is coherent.
 */
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

  const watchTargets = new Map<string, WorkspaceGitWatchTarget>();
  const workspaceStates = new Map<string, WorkspaceGitWatchState>();
  const subscriptions = new Map<string, () => void>();
  // Non-primary member directories. `workspaceStates` holds one cwd per workspace — the
  // primary member — so without these every other project in a multi-project workspace
  // would never be watched, and its checkout status would stay at whatever was computed
  // on demand. Kept apart from the primary watch because a member's branch must not drive
  // the workspace's branch-change notifications or its derived name.
  const memberTargets = new Map<string, Set<string>>();
  const memberSubscriptions = new Map<string, () => void>();

  function descriptorStateKey(workspace: WorkspaceDescriptorPayload | null): string {
    if (!workspace) {
      return WORKSPACE_GIT_WATCH_REMOVED_STATE_KEY;
    }
    return JSON.stringify([
      workspace.name,
      workspace.diffStat ? [workspace.diffStat.additions, workspace.diffStat.deletions] : null,
    ]);
  }

  function rememberDescriptorState(
    workspaceId: string,
    workspace: WorkspaceDescriptorPayload | null,
  ): void {
    const state = workspaceStates.get(workspaceId);
    if (!state) {
      return;
    }
    state.latestDescriptorStateKey = descriptorStateKey(workspace);
    const currentBranch = workspace?.gitRuntime?.currentBranch;
    if (currentBranch !== undefined) {
      state.lastBranchName = currentBranch;
    }
  }

  function removeForCwd(cwd: string): void {
    const normalizedCwd = resolve(cwd);
    const target = watchTargets.get(normalizedCwd);
    for (const workspaceId of target?.workspaceIds ?? []) {
      workspaceStates.delete(workspaceId);
    }
    watchTargets.delete(normalizedCwd);
    subscriptions.get(normalizedCwd)?.();
    subscriptions.delete(normalizedCwd);
    // A member of another workspace may still need this directory watched.
    ensureMemberSubscription(normalizedCwd);
  }

  function subscribeMember(normalizedCwd: string): void {
    const subscription = workspaceGitService.registerWorkspace(
      { cwd: normalizedCwd },
      (snapshot) => {
        void emitWorkspaceUpdateForCwd(normalizedCwd).catch((error) => {
          logger.warn(
            { err: error, cwd: normalizedCwd },
            "Failed to emit workspace update after member git snapshot",
          );
        });
        emitStatusUpdate(normalizedCwd, snapshot);
      },
    );
    memberSubscriptions.set(normalizedCwd, subscription.unsubscribe);
  }

  // One subscription per directory: the primary watch already covers it when present.
  function ensureMemberSubscription(normalizedCwd: string): void {
    if (!memberTargets.get(normalizedCwd)?.size) {
      return;
    }
    if (subscriptions.has(normalizedCwd) || memberSubscriptions.has(normalizedCwd)) {
      return;
    }
    try {
      subscribeMember(normalizedCwd);
    } catch (error) {
      logger.warn({ err: error, cwd: normalizedCwd }, "Failed to watch workspace member directory");
    }
  }

  function releaseMemberCwd(normalizedCwd: string, workspaceId: string): void {
    const holders = memberTargets.get(normalizedCwd);
    if (!holders) {
      return;
    }
    holders.delete(workspaceId);
    if (holders.size > 0) {
      return;
    }
    memberTargets.delete(normalizedCwd);
    memberSubscriptions.get(normalizedCwd)?.();
    memberSubscriptions.delete(normalizedCwd);
  }

  function removeMemberTargetsForWorkspaceId(workspaceId: string): void {
    // Snapshot: releaseMemberCwd deletes from the map it is iterating.
    for (const cwd of Array.from(memberTargets.keys())) {
      releaseMemberCwd(cwd, workspaceId);
    }
  }

  function syncMemberObservers(workspace: WorkspaceDescriptorPayload, primaryCwd: string): void {
    const desired = new Set<string>();
    for (const member of workspace.members ?? []) {
      if (member.workspaceKind === "directory") {
        continue;
      }
      const memberCwd = resolve(member.workspaceDirectory);
      if (memberCwd === primaryCwd) {
        continue;
      }
      desired.add(memberCwd);
    }

    for (const cwd of Array.from(memberTargets.keys())) {
      if (!desired.has(cwd)) {
        releaseMemberCwd(cwd, workspace.id);
      }
    }

    for (const cwd of desired) {
      const holders = memberTargets.get(cwd) ?? new Set<string>();
      holders.add(workspace.id);
      memberTargets.set(cwd, holders);
      ensureMemberSubscription(cwd);
    }
  }

  function removeForWorkspaceId(workspaceId: string): void {
    removeMemberTargetsForWorkspaceId(workspaceId);
    const state = workspaceStates.get(workspaceId);
    if (!state) {
      return;
    }
    workspaceStates.delete(workspaceId);
    const target = watchTargets.get(state.cwd);
    target?.workspaceIds.delete(workspaceId);
    if (target?.workspaceIds.size === 0) {
      removeForCwd(state.cwd);
    }
  }

  function handleBranchSnapshot(cwd: string, branchName: string | null): void {
    const target = watchTargets.get(resolve(cwd));
    if (!target) {
      return;
    }

    for (const workspaceId of target.workspaceIds) {
      const state = workspaceStates.get(workspaceId);
      if (!state) {
        continue;
      }
      const previousBranchName = state.lastBranchName;
      if (branchName === previousBranchName) {
        continue;
      }
      state.lastBranchName = branchName;
      onBranchChanged?.(workspaceId, previousBranchName, branchName);
    }
  }

  function syncObserver(cwd: string, options: { isGit: boolean; workspaceId: string }): void {
    const normalizedCwd = resolve(cwd);
    const currentState = workspaceStates.get(options.workspaceId);
    if (currentState && currentState.cwd !== normalizedCwd) {
      removeForWorkspaceId(options.workspaceId);
    }
    if (!options.isGit) {
      removeForWorkspaceId(options.workspaceId);
      return;
    }

    const target = watchTargets.get(normalizedCwd) ?? {
      workspaceIds: new Set<string>(),
    };
    watchTargets.set(normalizedCwd, target);
    target.workspaceIds.add(options.workspaceId);
    if (!workspaceStates.has(options.workspaceId)) {
      workspaceStates.set(options.workspaceId, {
        cwd: normalizedCwd,
        latestDescriptorStateKey: null,
        lastBranchName: null,
      });
    }

    if (subscriptions.has(normalizedCwd)) {
      return;
    }

    let subscription: ReturnType<WorkspaceGitService["registerWorkspace"]>;
    try {
      subscription = workspaceGitService.registerWorkspace({ cwd: normalizedCwd }, (snapshot) => {
        handleBranchSnapshot(normalizedCwd, snapshot.git.currentBranch ?? null);
        void emitWorkspaceUpdateForCwd(normalizedCwd).catch((error) => {
          logger.warn(
            { err: error, cwd: normalizedCwd },
            "Failed to emit workspace update after git branch snapshot",
          );
        });
        emitStatusUpdate(normalizedCwd, snapshot);
      });
    } catch (error) {
      removeForWorkspaceId(options.workspaceId);
      throw error;
    }
    subscriptions.set(normalizedCwd, subscription.unsubscribe);
  }

  function syncObservers(workspaces: Iterable<WorkspaceDescriptorPayload>): void {
    for (const workspace of workspaces) {
      syncObserver(workspace.workspaceDirectory, {
        isGit: workspace.workspaceKind !== "directory",
        workspaceId: workspace.id,
      });
      syncMemberObservers(workspace, resolve(workspace.workspaceDirectory));
      rememberDescriptorState(workspace.id, workspace);
    }
  }

  async function syncObserverForWorkspace(workspace: PersistedWorkspaceRecord): Promise<void> {
    const descriptor = await describeWorkspaceRecordWithGitData(workspace);
    syncObservers([descriptor]);
  }

  return {
    syncObservers,
    syncObserverForWorkspace,

    async warmGitData(workspace) {
      await syncObserverForWorkspace(workspace);
      await emitWorkspaceUpdateForWorkspaceId(workspace.workspaceId);
    },

    shouldSkipUpdate(workspaceId, workspace) {
      const state = workspaceStates.get(workspaceId);
      if (!state) {
        return false;
      }
      const nextStateKey = descriptorStateKey(workspace);
      if (state.latestDescriptorStateKey === nextStateKey) {
        return true;
      }
      state.latestDescriptorStateKey = nextStateKey;
      return false;
    },

    recordDescriptorState(workspaceId, nextWorkspace) {
      const state = workspaceStates.get(workspaceId);
      const newBranchName = nextWorkspace?.gitRuntime?.currentBranch;
      if (state && onBranchChanged && newBranchName !== undefined) {
        if (newBranchName !== state.lastBranchName) {
          onBranchChanged(workspaceId, state.lastBranchName, newBranchName);
        }
      }
      rememberDescriptorState(workspaceId, nextWorkspace);
    },

    handleBranchSnapshot,

    getMetrics() {
      return {
        watchedDirectoryCount: watchTargets.size + memberTargets.size,
        workspaceRecordCount: workspaceStates.size,
        subscriptionCount: subscriptions.size + memberSubscriptions.size,
      };
    },

    removeForWorkspaceId,

    dispose() {
      for (const unsubscribe of subscriptions.values()) {
        unsubscribe();
      }
      subscriptions.clear();
      for (const unsubscribe of memberSubscriptions.values()) {
        unsubscribe();
      }
      memberSubscriptions.clear();
      memberTargets.clear();
      watchTargets.clear();
      workspaceStates.clear();
    },
  };
}
