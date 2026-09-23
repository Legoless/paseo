import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface SidebarOrderStoreState {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  memberOrderByWorkspace: Record<string, string[]>;
  agentOrderByMember: Record<string, string[]>;
  /**
   * Flat top-level workspace order for the workspace-grouped sidebar. The per-project
   * `workspaceOrderByProject` predates the inversion and only survives for the project
   * structure hook; the sidebar's draggable workspace rows read and write this list.
   */
  workspaceOrder: string[];
  getProjectOrder: () => string[];
  setProjectOrder: (keys: string[]) => void;
  getPinnedWorkspaceOrder: () => string[];
  setPinnedWorkspaceOrder: (keys: string[]) => void;
  getWorkspaceOrder: (projectViewKey: string) => string[];
  setWorkspaceOrder: (projectViewKey: string, keys: string[]) => void;
  getTopLevelWorkspaceOrder: () => string[];
  setTopLevelWorkspaceOrder: (keys: string[]) => void;
  getMemberOrder: (workspaceKey: string) => string[];
  setMemberOrder: (workspaceKey: string, keys: string[]) => void;
  getAgentOrder: (memberKey: string) => string[];
  setAgentOrder: (memberKey: string, keys: string[]) => void;
  /**
   * Carries a bucket's remembered agent order to a new key. A member key embeds its
   * workspace, so moving a project between workspaces renames the bucket; without this the
   * old entry leaks forever and the project's agents come back in name order.
   */
  rekeyAgentOrder: (fromMemberKey: string, toMemberKey: string) => void;
}

interface SidebarOrderPersistedState {
  projectOrder?: string[];
  pinnedWorkspaceOrder?: string[];
  workspaceOrderByProject?: Record<string, string[]>;
  workspaceOrder?: string[];
  memberOrderByWorkspace?: Record<string, string[]>;
  agentOrderByMember?: Record<string, string[]>;
  projectOrderByServerId?: Record<string, string[]>;
  workspaceOrderByServerAndProject?: Record<string, string[]>;
}

const StringArrayRecordSchema = z.record(z.string(), z.array(z.string()));
const SidebarOrderPersistedStateSchema = z.strictObject({
  projectOrder: z.array(z.string()).optional(),
  pinnedWorkspaceOrder: z.array(z.string()).optional(),
  workspaceOrderByProject: StringArrayRecordSchema.optional(),
  workspaceOrder: z.array(z.string()).optional(),
  memberOrderByWorkspace: StringArrayRecordSchema.optional(),
  agentOrderByMember: StringArrayRecordSchema.optional(),
  projectOrderByServerId: StringArrayRecordSchema.optional(),
  workspaceOrderByServerAndProject: StringArrayRecordSchema.optional(),
});

interface SidebarWorkspaceOrderScope {
  serverId: string;
  projectViewKey: string;
}

// Trims each key. Only for persisted state read at migration time, where a
// stray space is an artifact of an older format rather than part of the key.
function normalizeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

/**
 * Drops blank keys and duplicates but keeps each key exactly as given. View
 * keys embed a project's path, so a directory whose name ends in a space
 * produces a key that ends in a space. Trimming it stores a key that can never
 * match the one the sidebar looks up, so the caller sees its key as missing,
 * writes it again, and the effect that reconciles the order never settles.
 */
function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const key of keys) {
    if (!key.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(key);
  }

  return deduped;
}

function normalizeScopedOrders(
  ordersByScope: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [rawScope, order] of Object.entries(ordersByScope ?? {})) {
    const scope = rawScope.trim();
    if (!scope) continue;
    normalized[scope] = normalizeKeys(order);
  }
  return normalized;
}

function extractWorkspaceOrderScope(scopeKey: string): SidebarWorkspaceOrderScope | null {
  const separatorIndex = scopeKey.indexOf("::");
  if (separatorIndex < 0) return null;
  const serverId = scopeKey.slice(0, separatorIndex).trim();
  const projectViewKey = scopeKey.slice(separatorIndex + 2).trim();
  if (!serverId || !projectViewKey) return null;
  return { serverId, projectViewKey };
}

function normalizeLegacyWorkspaceKey(serverId: string, rawWorkspaceKey: string): string | null {
  const workspaceKey = rawWorkspaceKey.trim();
  if (!workspaceKey) return null;
  const serverPrefix = `${serverId}:`;
  return workspaceKey.startsWith(serverPrefix) ? workspaceKey : `${serverPrefix}${workspaceKey}`;
}

export function migrateSidebarOrderState(persistedState: unknown): {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  workspaceOrder: string[];
  memberOrderByWorkspace: Record<string, string[]>;
  agentOrderByMember: Record<string, string[]>;
} {
  const result = SidebarOrderPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      workspaceOrder: [],
      memberOrderByWorkspace: {},
      agentOrderByMember: {},
    };
  }
  const state: SidebarOrderPersistedState = result.data;

  const projectOrder = normalizeKeys(state.projectOrder ?? []);
  const seenProjects = new Set(projectOrder);
  for (const keys of Object.values(state.projectOrderByServerId ?? {})) {
    for (const key of normalizeKeys(keys)) {
      if (seenProjects.has(key)) continue;
      seenProjects.add(key);
      projectOrder.push(key);
    }
  }

  const workspaceOrderByProject = normalizeScopedOrders(state.workspaceOrderByProject);
  for (const [scopeKey, order] of Object.entries(state.workspaceOrderByServerAndProject ?? {})) {
    const scope = extractWorkspaceOrderScope(scopeKey);
    if (!scope) continue;
    const existing = workspaceOrderByProject[scope.projectViewKey] ?? [];
    const merged = [...existing];
    const seen = new Set(merged);
    for (const key of order) {
      const workspaceKey = normalizeLegacyWorkspaceKey(scope.serverId, key);
      if (!workspaceKey || seen.has(workspaceKey)) continue;
      seen.add(workspaceKey);
      merged.push(workspaceKey);
    }
    workspaceOrderByProject[scope.projectViewKey] = merged;
  }

  return {
    projectOrder,
    pinnedWorkspaceOrder: normalizeKeys(state.pinnedWorkspaceOrder ?? []),
    workspaceOrderByProject,
    workspaceOrder: normalizeKeys(state.workspaceOrder ?? []),
    memberOrderByWorkspace: normalizeScopedOrders(state.memberOrderByWorkspace),
    agentOrderByMember: normalizeScopedOrders(state.agentOrderByMember),
  };
}

export const useSidebarOrderStore = create<SidebarOrderStoreState>()(
  persist(
    (set, get) => ({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      workspaceOrder: [],
      memberOrderByWorkspace: {},
      agentOrderByMember: {},
      getProjectOrder: () => get().projectOrder,
      setProjectOrder: (keys) => {
        set({ projectOrder: dedupeKeys(keys) });
      },
      getPinnedWorkspaceOrder: () => get().pinnedWorkspaceOrder,
      setPinnedWorkspaceOrder: (keys) => {
        set({ pinnedWorkspaceOrder: dedupeKeys(keys) });
      },
      getWorkspaceOrder: (projectViewKey) => {
        if (!projectViewKey.trim()) return [];
        return get().workspaceOrderByProject[projectViewKey] ?? [];
      },
      setWorkspaceOrder: (projectViewKey, keys) => {
        if (!projectViewKey.trim()) return;
        set((state) => ({
          workspaceOrderByProject: {
            ...state.workspaceOrderByProject,
            [projectViewKey]: dedupeKeys(keys),
          },
        }));
      },
      getTopLevelWorkspaceOrder: () => get().workspaceOrder,
      setTopLevelWorkspaceOrder: (keys) => {
        set({ workspaceOrder: dedupeKeys(keys) });
      },
      getMemberOrder: (workspaceKey) => {
        if (!workspaceKey.trim()) return [];
        return get().memberOrderByWorkspace[workspaceKey] ?? [];
      },
      setMemberOrder: (workspaceKey, keys) => {
        if (!workspaceKey.trim()) return;
        set((state) => ({
          memberOrderByWorkspace: {
            ...state.memberOrderByWorkspace,
            [workspaceKey]: dedupeKeys(keys),
          },
        }));
      },
      // Member keys embed a project's cwd, so they keep a trailing space for the same
      // reason view keys do (see dedupeKeys).
      getAgentOrder: (memberKey) => {
        if (!memberKey.trim()) return [];
        return get().agentOrderByMember[memberKey] ?? [];
      },
      setAgentOrder: (memberKey, keys) => {
        if (!memberKey.trim()) return;
        set((state) => ({
          agentOrderByMember: {
            ...state.agentOrderByMember,
            [memberKey]: dedupeKeys(keys),
          },
        }));
      },
      rekeyAgentOrder: (from, to) => {
        if (!from.trim() || !to.trim() || from === to) return;
        set((state) => {
          const carried = state.agentOrderByMember[from];
          if (!carried) return state;
          const { [from]: _dropped, ...rest } = state.agentOrderByMember;
          return { agentOrderByMember: { ...rest, [to]: carried } };
        });
      },
    }),
    {
      name: "sidebar-project-workspace-order",
      storage: createValidatedPersistStorage(AsyncStorage, SidebarOrderPersistedStateSchema),
      partialize: (state) => ({
        projectOrder: state.projectOrder,
        pinnedWorkspaceOrder: state.pinnedWorkspaceOrder,
        workspaceOrderByProject: state.workspaceOrderByProject,
        workspaceOrder: state.workspaceOrder,
        memberOrderByWorkspace: state.memberOrderByWorkspace,
        agentOrderByMember: state.agentOrderByMember,
      }),
      version: 2,
      migrate: migrateSidebarOrderState,
    },
  ),
);
