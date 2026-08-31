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
        const normalized = normalizeKeys(keys);
        set({ projectOrder: normalized });
      },
      getPinnedWorkspaceOrder: () => get().pinnedWorkspaceOrder,
      setPinnedWorkspaceOrder: (keys) => {
        const normalized = normalizeKeys(keys);
        set({ pinnedWorkspaceOrder: normalized });
      },
      getWorkspaceOrder: (projectViewKey) => {
        const scope = projectViewKey.trim();
        if (!scope) return [];
        return get().workspaceOrderByProject[scope] ?? [];
      },
      setWorkspaceOrder: (projectViewKey, keys) => {
        const scope = projectViewKey.trim();
        if (!scope) return;
        const normalized = normalizeKeys(keys);
        set((state) => ({
          workspaceOrderByProject: {
            ...state.workspaceOrderByProject,
            [scope]: normalized,
          },
        }));
      },
      getTopLevelWorkspaceOrder: () => get().workspaceOrder,
      setTopLevelWorkspaceOrder: (keys) => {
        const normalized = normalizeKeys(keys);
        set({ workspaceOrder: normalized });
      },
      getMemberOrder: (workspaceKey) => {
        const scope = workspaceKey.trim();
        if (!scope) return [];
        return get().memberOrderByWorkspace[scope] ?? [];
      },
      setMemberOrder: (workspaceKey, keys) => {
        const scope = workspaceKey.trim();
        if (!scope) return;
        const normalized = normalizeKeys(keys);
        set((state) => ({
          memberOrderByWorkspace: {
            ...state.memberOrderByWorkspace,
            [scope]: normalized,
          },
        }));
      },
      getAgentOrder: (memberKey) => {
        const scope = memberKey.trim();
        if (!scope) return [];
        return get().agentOrderByMember[scope] ?? [];
      },
      setAgentOrder: (memberKey, keys) => {
        const scope = memberKey.trim();
        if (!scope) return;
        const normalized = normalizeKeys(keys);
        set((state) => ({
          agentOrderByMember: {
            ...state.agentOrderByMember,
            [scope]: normalized,
          },
        }));
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
