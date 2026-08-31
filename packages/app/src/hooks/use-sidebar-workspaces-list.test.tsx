/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import {
  useSidebarWorkspaceGroupSections,
  useSidebarWorkspacesList,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceGroupModel } from "@/projects/workspace-groups";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useSessionStore } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { defaultHostAppearance } from "@/hosts/appearance";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("expo-router", () => ({
  router: {
    dismissTo: vi.fn(),
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

const SERVER_ID = "sidebar-group-sections";

function member(input: {
  projectId: string;
  projectDisplayName: string;
  workspaceDirectory: string;
  branch?: string | null;
}): WorkspaceDescriptor["members"][number] {
  return {
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectCustomName: null,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: input.workspaceDirectory,
    workspaceKind: "worktree",
    worktreeSlug: null,
    branch: input.branch ?? null,
  };
}

function workspace(input: {
  id: string;
  members: WorkspaceDescriptor["members"];
}): WorkspaceDescriptor {
  const primary = input.members[0];
  if (!primary) {
    throw new Error("workspace requires at least one member");
  }
  return {
    id: input.id,
    projectId: primary.projectId,
    projectDisplayName: primary.projectDisplayName,
    projectRootPath: primary.projectRootPath,
    workspaceDirectory: primary.workspaceDirectory,
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    members: input.members,
  };
}

function agent(input: {
  id: string;
  workspaceId: string;
  cwd: string;
  status?: Agent["status"];
  title?: string | null;
  archivedAt?: Date | null;
}): Agent {
  return {
    serverId: SERVER_ID,
    id: input.id,
    provider: "claude" as Agent["provider"],
    status: input.status ?? "idle",
    activeTurn: null,
    createdAt: new Date(0),
    updatedAt: new Date(1_000),
    lastUserMessageAt: null,
    lastActivityAt: new Date(1_000),
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: input.title ?? null,
    cwd: input.cwd,
    workspaceId: input.workspaceId,
    model: null,
    parentAgentId: null,
    archivedAt: input.archivedAt ?? null,
    labels: {},
  };
}

const MULTI_PROJECT_WORKSPACE = workspace({
  id: "ws-multi",
  members: [
    {
      ...member({
        projectId: "project-a",
        projectDisplayName: "Project A",
        workspaceDirectory: "/repo/project-a/ws-multi",
        branch: "main",
      }),
      diffStat: { additions: 12, deletions: 3 },
    },
    member({
      projectId: "project-b",
      projectDisplayName: "Project B",
      workspaceDirectory: "/repo/project-b/ws-multi",
      branch: "feature",
    }),
  ],
});

function makeHost(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: SERVER_ID,
    label: "Group Sections Host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setHostProfiles(hosts: HostProfile[]): void {
  (
    getHostRuntimeStore() as unknown as {
      setHostsAndSync: (hosts: HostProfile[]) => void;
    }
  ).setHostsAndSync(hosts);
}

function seedAgents(agents: Agent[]): void {
  useSessionStore
    .getState()
    .setAgents(SERVER_ID, new Map(agents.map((entry) => [entry.id, entry])));
}

function GroupSectionsProbe({
  onModel,
}: {
  onModel: (model: SidebarWorkspaceGroupModel) => void;
}): null {
  const { workspacePlacements } = useSidebarWorkspacesList({ hostFilters: [SERVER_ID] });
  const model = useSidebarWorkspaceGroupSections({ placements: workspacePlacements });
  onModel(model);
  return null;
}

let latestGroupModel: SidebarWorkspaceGroupModel | null = null;

function handleGroupModel(model: SidebarWorkspaceGroupModel): void {
  latestGroupModel = model;
}

describe("useSidebarWorkspaceGroupSections", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    act(() => {
      setHostProfiles([makeHost()]);
      useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
      seedSessionWorkspaces(
        SERVER_ID,
        new Map([[MULTI_PROJECT_WORKSPACE.id, MULTI_PROJECT_WORKSPACE]]),
      );
      useSessionStore.getState().setHasHydratedWorkspaces(SERVER_ID, true);
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<GroupSectionsProbe onModel={handleGroupModel} />);
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    latestGroupModel = null;
    act(() => {
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
        workspaceOrder: [],
      });
    });
  });

  it("exposes a section per workspace with its project members", () => {
    const section = latestGroupModel?.sectionsByWorkspaceKey.get(`${SERVER_ID}:ws-multi`);

    expect(section?.members.map((entry) => entry.projectId)).toEqual(["project-a", "project-b"]);
    expect(section?.members[0]?.diffStat).toEqual({ additions: 12, deletions: 3 });
    expect(section?.members[1]?.diffStat).toBeNull();
    expect(
      latestGroupModel?.memberIconTargets.map((target) => target.projectViewKey).sort(),
    ).toEqual([
      `${SERVER_ID}:ws-multi#/repo/project-a/ws-multi`,
      `${SERVER_ID}:ws-multi#/repo/project-b/ws-multi`,
    ]);
  });

  it("buckets workspace agents under their member and falls back to the primary", () => {
    act(() => {
      seedAgents([
        agent({
          id: "agent-a",
          workspaceId: "ws-multi",
          cwd: "/repo/project-a/ws-multi",
          title: "Agent A",
        }),
        agent({
          id: "agent-b",
          workspaceId: "ws-multi",
          cwd: "/repo/project-b/ws-multi",
          status: "running",
        }),
        agent({ id: "agent-stray", workspaceId: "ws-multi", cwd: "/elsewhere" }),
        agent({
          id: "agent-archived",
          workspaceId: "ws-multi",
          cwd: "/repo/project-a/ws-multi",
          archivedAt: new Date(2_000),
        }),
      ]);
    });

    const section = latestGroupModel?.sectionsByWorkspaceKey.get(`${SERVER_ID}:ws-multi`);
    const memberA = section?.members.find((entry) => entry.projectId === "project-a");
    const memberB = section?.members.find((entry) => entry.projectId === "project-b");
    expect(memberA?.agents.map((entry) => entry.agentId)).toEqual(["agent-a", "agent-stray"]);
    expect(memberB?.agents.map((entry) => entry.agentId)).toEqual(["agent-b"]);
    expect(memberB?.agents[0]?.statusBucket).toBe("running");
  });

  it("creates no section for an orphan project with no workspace", () => {
    act(() => {
      seedSessionWorkspaces(
        SERVER_ID,
        new Map([[MULTI_PROJECT_WORKSPACE.id, MULTI_PROJECT_WORKSPACE]]),
        [
          {
            projectId: "project-orphan",
            projectKey: "project-orphan",
            projectDisplayName: "Orphan",
            projectCustomName: null,
            projectRootPath: "/repo/project-orphan",
            projectKind: "git",
          },
        ],
      );
    });

    expect(latestGroupModel?.sectionsByWorkspaceKey.size).toBe(1);
    expect([...(latestGroupModel?.sectionsByWorkspaceKey.keys() ?? [])]).toEqual([
      `${SERVER_ID}:ws-multi`,
    ]);
  });

  it("keeps the previous model while the host's session is gone", () => {
    const before = latestGroupModel;

    act(() => {
      useSessionStore.getState().clearSession(SERVER_ID);
    });

    expect(latestGroupModel).toBe(before);
  });
});
