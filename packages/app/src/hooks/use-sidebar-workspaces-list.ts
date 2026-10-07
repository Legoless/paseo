import equal from "fast-deep-equal";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  buildSidebarWorkspaceGroupModel,
  preserveSidebarWorkspaceGroupModelIdentity,
  type SidebarWorkspaceGroupModel,
  type SidebarWorkspaceGroupSession,
} from "@/projects/workspace-groups";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectoryServerIds } from "@/stores/session-store-hooks";
import { useHostProjects } from "@/projects/host-projects";
import { getHostRuntimeStore, useHostRegistryLoaded, useHosts } from "@/runtime/host-runtime";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  buildSidebarWorkspacePlacementModel,
  computeSidebarOrderUpdates,
  createSidebarWorkspaceEntry,
  deriveProjectStatusBucket,
  deriveSidebarLoadingState,
  prependMissingOrderKeys,
  selectProjectlessWorkspacePlacements,
  type ProjectStatusSession,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "./sidebar-workspaces-view-model";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export {
  appendMissingOrderKeys,
  applyStoredOrdering,
  buildSidebarProjectsFromHostProjects,
  buildSidebarProjectsFromStructure,
  compareSidebarWorkspacePlacements,
  createSidebarWorkspaceEntry,
  buildSidebarWorkspacePlacementModel,
  computeSidebarOrderUpdates,
  deriveProjectStatusBucket,
  deriveSidebarLoadingState,
  shouldShowSidebarHostLabels,
  prependMissingOrderKeys,
  type SidebarLoadingState,
  type SidebarOrderUpdates,
  type SidebarStatusWorkspacePlacement,
  type SidebarWorkspacePlacement,
  type SidebarWorkspacePlacementModel,
  type ProjectStatusSession,
  type SidebarProjectEntry,
  type SidebarStateBucket,
  type SidebarWorkspaceEntry,
} from "./sidebar-workspaces-view-model";

const EMPTY_ORDER: string[] = [];
const EMPTY_PROJECTS: SidebarProjectEntry[] = [];
const EMPTY_WORKSPACES: SidebarWorkspacePlacement[] = [];
const EMPTY_PROJECT_NAMES = new Map<string, string>();

export interface SidebarWorkspacesListResult {
  workspacePlacements: SidebarWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByViewKey: Map<string, string>;
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

export function useSidebarWorkspacesList(options?: {
  hostFilters?: readonly string[];
  enabled?: boolean;
}): SidebarWorkspacesListResult {
  const runtime = getHostRuntimeStore();
  const allHosts = useHosts();
  const hostRegistryLoaded = useHostRegistryLoaded();
  const allServerIds = useMemo(() => allHosts.map((h) => h.serverId), [allHosts]);

  const storeHostFilters = useSidebarViewStore((state) => state.hostFilters);
  const hostFilters = options?.hostFilters ?? storeHostFilters;
  const reconcileHostFilters = useSidebarViewStore((state) => state.reconcileHostFilters);
  const isActive = options?.enabled !== false;

  const serverIds = useMemo(() => {
    if (hostFilters.length === 0) {
      return allServerIds;
    }
    const selected = new Set(hostFilters);
    const matched = allServerIds.filter((id) => selected.has(id));
    // Registry has settled but none of the pinned hosts still exist — fall back to every
    // host rather than leaving the sidebar empty.
    if (hostRegistryLoaded && matched.length === 0) {
      return allServerIds;
    }
    return matched;
  }, [allServerIds, hostFilters, hostRegistryLoaded]);
  useEffect(() => {
    if (!isActive) return;
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [isActive, runtime, serverIds]);

  useEffect(() => {
    if (!hostRegistryLoaded) {
      return;
    }
    reconcileHostFilters(allServerIds);
  }, [allServerIds, hostRegistryLoaded, reconcileHostFilters]);

  const persistedProjectOrder = useSidebarOrderStore((state) => state.projectOrder ?? EMPTY_ORDER);
  const persistedWorkspaceOrder = useSidebarOrderStore(
    (state) => state.workspaceOrder ?? EMPTY_ORDER,
  );

  const directoryServerIds = useWorkspaceDirectoryServerIds(serverIds);

  const hostProjects = useHostProjects(directoryServerIds);

  // One collection-level subscription, deep-compared so the array keeps its identity through the
  // workspace churn (diffs, status, git facts) that never changes a placement.
  const projectlessWorkspaces = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      isActive
        ? selectProjectlessWorkspacePlacements(state.sessions, directoryServerIds)
        : EMPTY_WORKSPACES,
    equal,
  );

  const sidebarModel = useMemo(
    () =>
      buildSidebarWorkspacePlacementModel({
        projects: hostProjects,
        projectlessWorkspaces,
      }),
    [hostProjects, projectlessWorkspaces],
  );

  const projects = sidebarModel.projects.length > 0 ? sidebarModel.projects : EMPTY_PROJECTS;
  const workspacePlacements =
    sidebarModel.workspaces.length > 0 ? sidebarModel.workspaces : EMPTY_WORKSPACES;
  const projectNamesByViewKey =
    sidebarModel.projectNamesByViewKey.size > 0
      ? sidebarModel.projectNamesByViewKey
      : EMPTY_PROJECT_NAMES;

  useEffect(() => {
    const orderStore = useSidebarOrderStore.getState();
    const updates = computeSidebarOrderUpdates({
      projects,
      persistedProjectOrder,
      getWorkspaceOrder: (projectViewKey) =>
        orderStore.workspaceOrderByProject[projectViewKey] ?? EMPTY_ORDER,
    });

    if (updates.projectOrder) {
      orderStore.setProjectOrder(updates.projectOrder);
    }
    for (const { projectViewKey, order } of updates.workspaceOrders) {
      orderStore.setWorkspaceOrder(projectViewKey, order);
    }
  }, [persistedProjectOrder, projects]);

  // New workspaces enter the flat order ahead of the dragged one, matching the recency-first
  // behavior the per-project lists had. The stored list accumulates keys for workspaces a
  // filter currently hides; pruning happens against the visible set at drag time instead.
  useEffect(() => {
    const nextWorkspaceOrder = prependMissingOrderKeys({
      currentOrder: persistedWorkspaceOrder,
      visibleKeys: workspacePlacements.map((workspace) => workspace.workspaceKey),
    });
    if (nextWorkspaceOrder !== persistedWorkspaceOrder) {
      useSidebarOrderStore.getState().setTopLevelWorkspaceOrder(nextWorkspaceOrder);
    }
  }, [persistedWorkspaceOrder, workspacePlacements]);

  const refreshAll = useCallback(() => {
    if (!isActive) return;
    for (const serverId of serverIds) {
      void runtime.refreshDirectories(serverId).catch((error) => {
        console.error("[WorkspaceFetch][sidebar-refresh] failed", {
          serverId,
          error,
        });
      });
    }
  }, [isActive, runtime, serverIds]);

  const loadingState = deriveSidebarLoadingState({
    isActive,
    serverIds,
    hydratedServerIds: directoryServerIds,
    hasProjects: projects.length > 0,
  });

  return {
    workspacePlacements,
    projects,
    projectNamesByViewKey,
    ...loadingState,
    refreshAll,
  };
}

const EMPTY_GROUP_SESSIONS: SidebarWorkspaceGroupSession[] = [];
const EMPTY_WORKSPACE_LAYOUTS = {};
const EMPTY_GROUP_MODEL: SidebarWorkspaceGroupModel = {
  sectionsByWorkspaceKey: new Map(),
  memberIconTargets: [],
};

interface SidebarWorkspaceGroupSessionState {
  sessions: Record<
    string,
    Pick<SidebarWorkspaceGroupSession, "workspaces" | "agents" | "projects"> | undefined
  >;
}

function selectGroupSessions(
  sessions: SidebarWorkspaceGroupSessionState["sessions"],
  serverIds: readonly string[],
): SidebarWorkspaceGroupSession[] {
  const selected: SidebarWorkspaceGroupSession[] = [];
  for (const serverId of serverIds) {
    const session = sessions[serverId];
    if (!session) continue;
    selected.push({
      serverId,
      workspaces: session.workspaces,
      agents: session.agents,
      projects: session.projects,
    });
  }
  return selected;
}

function areGroupSessionsEqual(
  left: readonly SidebarWorkspaceGroupSession[],
  right: readonly SidebarWorkspaceGroupSession[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (
      !leftSession ||
      !rightSession ||
      leftSession.serverId !== rightSession.serverId ||
      leftSession.workspaces !== rightSession.workspaces ||
      leftSession.agents !== rightSession.agents ||
      leftSession.projects !== rightSession.projects
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The member/project rows and agent rows under each top-level workspace. Subscribes to the
 * per-server workspace, agent, and project maps in one shot — per-row subscriptions would
 * multiply against every workspace on every visible host. While the sidebar is retained but
 * inactive the last model is kept and the subscription goes quiet.
 */
export function useSidebarWorkspaceGroupSections(input: {
  placements: readonly SidebarWorkspacePlacement[];
  enabled?: boolean;
}): SidebarWorkspaceGroupModel {
  const enabled = input.enabled !== false;
  const serverIds = useMemo(
    () => Array.from(new Set(input.placements.map((placement) => placement.serverId))),
    [input.placements],
  );
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) => (enabled ? selectGroupSessions(state.sessions, serverIds) : EMPTY_GROUP_SESSIONS),
    areGroupSessionsEqual,
  );
  const layoutsByWorkspace = useWorkspaceLayoutStore((state) =>
    enabled ? state.layoutByWorkspace : EMPTY_WORKSPACE_LAYOUTS,
  );
  const previousModelRef = useRef<SidebarWorkspaceGroupModel>(EMPTY_GROUP_MODEL);
  return useMemo(() => {
    if (!enabled || sessions.length === 0) {
      return previousModelRef.current;
    }
    const next = buildSidebarWorkspaceGroupModel({ sessions, layoutsByWorkspace });
    const model = preserveSidebarWorkspaceGroupModelIdentity(previousModelRef.current, next);
    previousModelRef.current = model;
    return model;
  }, [enabled, layoutsByWorkspace, sessions]);
}
