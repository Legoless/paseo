import { useMemo, useRef } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";
import { useSessionStore } from "@/stores/session-store";

export interface PinnedSidebarKeys {
  pinnedWorkspaceKeys: string[];
  // workspaceKey -> pinnedAt ISO string, used to order by recency.
  pinnedAtByKey: Record<string, string>;
}

export interface PinnedSidebarGroups {
  // Individually pinned chats, hoisted into the Pinned section and removed from the
  // workspace list below. Most recently pinned first.
  pinnedChats: SidebarWorkspacePlacement[];
  // Everything else. Feeds the workspace-grouped list's top-level rows.
  unpinnedWorkspaces: SidebarWorkspacePlacement[];
}

function buildPinnedSidebarKeys(
  workspaces: readonly SidebarWorkspacePlacement[],
  workspaceMaps: ReadonlyMap<string, ReadonlyMap<string, { pinnedAt?: string | null }>>,
): PinnedSidebarKeys {
  const pinnedWorkspaceKeys: string[] = [];
  const pinnedAtByKey: Record<string, string> = {};

  for (const placement of workspaces) {
    const workspace = workspaceMaps.get(placement.serverId)?.get(placement.workspaceId);
    if (workspace?.pinnedAt) {
      pinnedWorkspaceKeys.push(placement.workspaceKey);
      pinnedAtByKey[placement.workspaceKey] = workspace.pinnedAt;
    }
  }
  return { pinnedWorkspaceKeys, pinnedAtByKey };
}

function arePinnedSidebarKeysEqual(left: PinnedSidebarKeys, right: PinnedSidebarKeys): boolean {
  if (left.pinnedWorkspaceKeys.length !== right.pinnedWorkspaceKeys.length) {
    return false;
  }
  for (let index = 0; index < left.pinnedWorkspaceKeys.length; index += 1) {
    const workspaceKey = left.pinnedWorkspaceKeys[index];
    if (
      workspaceKey !== right.pinnedWorkspaceKeys[index] ||
      (workspaceKey && left.pinnedAtByKey[workspaceKey] !== right.pinnedAtByKey[workspaceKey])
    ) {
      return false;
    }
  }
  return true;
}

export function usePinnedSidebarKeys(
  workspaces: readonly SidebarWorkspacePlacement[],
): PinnedSidebarKeys {
  const previousKeysRef = useRef<PinnedSidebarKeys>({
    pinnedWorkspaceKeys: [],
    pinnedAtByKey: {},
  });
  const serverIds = useMemo(
    () => Array.from(new Set(workspaces.map((workspace) => workspace.serverId))),
    [workspaces],
  );
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => serverIds.map((serverId) => state.sessions[serverId]?.workspaces ?? null),
    shallow,
  );
  return useMemo(() => {
    const workspaceMapByServerId = new Map<
      string,
      ReadonlyMap<string, { pinnedAt?: string | null }>
    >();
    for (let index = 0; index < serverIds.length; index += 1) {
      const serverId = serverIds[index];
      const workspaceMap = workspaceMaps[index];
      if (serverId && workspaceMap) {
        workspaceMapByServerId.set(serverId, workspaceMap);
      }
    }
    const nextKeys = buildPinnedSidebarKeys(workspaces, workspaceMapByServerId);
    if (arePinnedSidebarKeysEqual(previousKeysRef.current, nextKeys)) {
      return previousKeysRef.current;
    }
    previousKeysRef.current = nextKeys;
    return nextKeys;
  }, [workspaces, serverIds, workspaceMaps]);
}

// Splits the sidebar into a dedicated Pinned section (chats) and the regular list below.
// Pinned chats are ordered most-recently-pinned first.
export function splitPinnedSidebarGroups(input: {
  workspaces: readonly SidebarWorkspacePlacement[];
  keys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
}): PinnedSidebarGroups {
  const { workspaces, keys, pinnedWorkspaceOrder } = input;
  if (keys.pinnedWorkspaceKeys.length === 0) {
    return { pinnedChats: [], unpinnedWorkspaces: [...workspaces] };
  }
  const pinnedWorkspaceKeySet = new Set(keys.pinnedWorkspaceKeys);
  const pinnedChats: SidebarWorkspacePlacement[] = [];
  const unpinnedWorkspaces: SidebarWorkspacePlacement[] = [];

  for (const workspace of workspaces) {
    if (pinnedWorkspaceKeySet.has(workspace.workspaceKey)) {
      pinnedChats.push(workspace);
    } else {
      unpinnedWorkspaces.push(workspace);
    }
  }

  pinnedChats.sort((a, b) =>
    (keys.pinnedAtByKey[b.workspaceKey] ?? "").localeCompare(
      keys.pinnedAtByKey[a.workspaceKey] ?? "",
    ),
  );

  return {
    pinnedChats: applyStoredOrdering({
      items: pinnedChats,
      storedOrder: pinnedWorkspaceOrder,
      getKey: (workspace) => workspace.workspaceKey,
    }),
    unpinnedWorkspaces,
  };
}
