/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { ReactElement } from "react";
import { createProjectViewKey } from "@/projects/workspace-structure";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const pathnameState = vi.hoisted(() => ({
  value: "/",
}));

vi.mock("expo-router", () => ({
  router: {
    dismissTo: vi.fn(),
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => pathnameState.value,
}));

import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import {
  getHostRuntimeStore,
  type HostRuntimeController,
  type HostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { defaultHostAppearance } from "@/hosts/appearance";
import { SidebarWorkspaceMenu } from "@/components/sidebar/sidebar-workspace-menu";
import { WorkspaceMemberMenuItems } from "@/components/sidebar/workspace-member-menu";
import type { SidebarWorkspaceMemberRow } from "@/projects/workspace-groups";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/components/ui/context-menu", () => {
  const ReactMock = require("react") as typeof import("react");
  const StubItem = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    ReactMock.createElement("button", { "data-testid": testID, type: "button" }, children);
  return {
    ContextMenu: ({ children }: { children: React.ReactNode }) => children,
    ContextMenuContent: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      ReactMock.createElement("div", { "data-testid": testID }, children),
    ContextMenuItem: StubItem,
    ContextMenuTrigger: StubItem,
    ContextMenuSeparator: () => null,
  };
});

vi.mock("@/components/ui/dropdown-menu", () => {
  const ReactMock = require("react") as typeof import("react");
  const StubItem = ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
    ReactMock.createElement("button", { "data-testid": testID, type: "button" }, children);
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => children,
    DropdownMenuContent: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      ReactMock.createElement("div", { "data-testid": testID }, children),
    DropdownMenuItem: StubItem,
    DropdownMenuTrigger: StubItem,
    DropdownMenuSubTrigger: StubItem,
    DropdownMenuSeparator: () => null,
  };
});

vi.mock("@/workspace/open-in-file-manager/menu-item", () => {
  const ReactMock = require("react") as typeof import("react");
  return {
    OpenInFileManagerMenuItem: ({ testID }: { testID?: string }) =>
      ReactMock.createElement("div", { "data-testid": testID }),
  };
});

vi.mock("@/workspace-labels/picker", () => ({
  WORKSPACE_LABEL_PAGE_ID: "workspaceLabels",
  useWorkspaceLabelMenuPages: () => [],
}));

vi.mock("@/workspace-layouts/picker", () => ({
  PANE_LAYOUT_PAGE_ID: "paneLayout",
  useCanApplyPaneLayouts: () => false,
  usePaneLayoutMenuPages: () => [],
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({
    error: vi.fn(),
    copied: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const testMember: SidebarWorkspaceMemberRow = {
  memberKey: "test-wk#/repo/project-a/main",
  projectId: "project-a",
  projectName: "Project A",
  workspaceDirectory: "/repo/project-a/main",
  workspaceDirectoryLabel: "main",
  diffStat: null,
  isPrimary: true,
  agents: [],
};

const SERVER_ID = "sidebar-render-count";
const WORKSPACE_ID = "test-wk";

interface RenderCounts {
  frame: number;
  headers: Record<string, number>;
  rows: Record<string, number>;
  projectSelection: Record<string, number>;
  rowSelection: Record<string, number>;
}

const runningScript: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web.paseo.localhost",
  port: 3000,
  proxyUrl: "http://web.paseo.localhost:6767",
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

function workspace(input: {
  id: string;
  projectId: string;
  projectDisplayName: string;
  name: string;
  status?: WorkspaceDescriptor["status"];
  scripts?: WorkspaceDescriptor["scripts"];
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: `/repo/${input.projectId}/${input.id}`,
    projectKind: "git",
    workspaceKind: input.name === "main" ? "local_checkout" : "worktree",
    name: input.name,
    status: input.status ?? "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: input.scripts ?? [],
    members: [
      {
        projectId: input.projectId,
        projectDisplayName: input.projectDisplayName,
        projectCustomName: null,
        projectRootPath: `/repo/${input.projectId}`,
        workspaceDirectory: `/repo/${input.projectId}/${input.id}`,
        workspaceKind: input.name === "main" ? "local_checkout" : "worktree",
        worktreeSlug: null,
        branch: null,
      },
    ],
  };
}

function createWorkspaces(): WorkspaceDescriptor[] {
  return [
    workspace({
      id: "a-main",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "main",
      scripts: [runningScript],
    }),
    workspace({
      id: "a-one",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "one",
    }),
    workspace({
      id: "a-two",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "two",
    }),
    workspace({
      id: "b-main",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "main",
    }),
    workspace({
      id: "b-one",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "one",
    }),
    workspace({
      id: "b-two",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "two",
    }),
  ];
}

function makeHost(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: SERVER_ID,
    label: "Render Count Host",
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

function initializeSidebarState(workspaces: WorkspaceDescriptor[]): void {
  act(() => {
    setHostProfiles([makeHost()]);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map(workspaces.map((entry) => [entry.id, entry])));
    useSessionStore.getState().setHasHydratedWorkspaces(SERVER_ID, true);
    useSidebarOrderStore.setState({
      projectOrder: ["project-a", "project-b"],
      workspaceOrderByProject: {
        ["project-a"]: [`${SERVER_ID}:a-main`, `${SERVER_ID}:a-one`, `${SERVER_ID}:a-two`],
        ["project-b"]: [`${SERVER_ID}:b-main`, `${SERVER_ID}:b-one`, `${SERVER_ID}:b-two`],
      },
    });
  });
}

function resetCounts(counts: RenderCounts): void {
  counts.frame = 0;
  counts.headers = {};
  counts.rows = {};
  counts.projectSelection = {};
  counts.rowSelection = {};
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function ProjectHeaderProbe({
  project,
  counts,
}: {
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  incrementRecord(counts.headers, project.viewKey);
  return null;
}

function WorkspaceRowProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const workspaceEntry = useWorkspaceFields(serverId, workspaceId, (entry) =>
    createSidebarWorkspaceEntry({ serverId, workspace: entry }),
  );
  if (workspaceEntry) {
    incrementRecord(counts.rows, workspaceEntry.workspaceId);
  }
  return null;
}

function ProjectActiveProbe({
  serverId,
  project,
  counts,
}: {
  serverId: string;
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const isActive =
    activeSelection?.serverId === serverId &&
    project.workspaces.some((entry) => entry.workspaceId === activeSelection.workspaceId);
  void isActive;
  incrementRecord(counts.projectSelection, project.viewKey);
  return null;
}

function WorkspaceSelectionProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const selected =
    activeSelection?.serverId === serverId && activeSelection.workspaceId === workspaceId;
  void selected;
  incrementRecord(counts.rowSelection, workspaceId);
  return null;
}

function SidebarFrameProbe({ counts }: { counts: RenderCounts }): ReactElement {
  counts.frame += 1;
  const { projects } = useSidebarWorkspacesList({ hostFilters: [SERVER_ID] });

  return (
    <>
      {projects.map((project) => (
        <div key={project.viewKey}>
          <ProjectHeaderProbe project={project} counts={counts} />
          <ProjectActiveProbe serverId={SERVER_ID} project={project} counts={counts} />
          {project.workspaces.map((entry) => (
            <React.Fragment key={entry.workspaceKey}>
              <WorkspaceRowProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
              <WorkspaceSelectionProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </>
  );
}

function getHostController(): HostRuntimeController {
  const controllers = (
    getHostRuntimeStore() as unknown as {
      controllers: Map<string, HostRuntimeController>;
    }
  ).controllers;
  const controller = controllers.get(SERVER_ID);
  if (!controller) {
    throw new Error("Host runtime controller was not initialized");
  }
  return controller;
}

function updateControllerSnapshot(
  patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
): void {
  (
    getHostController() as unknown as {
      updateSnapshot: (
        patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
      ) => void;
    }
  ).updateSnapshot(patch);
}

async function renderProbe(counts: RenderCounts): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    renderSidebarFrame(root, counts);
  });
  resetCounts(counts);
  return { root, container };
}

function renderSidebarFrame(root: Root, counts: RenderCounts) {
  root.render(<SidebarFrameProbe counts={counts} />);
}

describe("sidebar workspace render isolation", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    initializeSidebarState(createWorkspaces());
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
    act(() => {
      pathnameState.value = "/";
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
      });
    });
  });

  it("re-renders only the changed workspace row for a status update", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      useSessionStore.getState().mergeWorkspaces(SERVER_ID, [
        {
          ...createWorkspaces()[1],
          status: "running",
        },
      ]);
    });

    expect(counts.frame).toBe(0);
    expect(counts.headers).toEqual({});
    expect(counts.rows).toEqual({ "a-one": 1 });
  });

  it("does not re-render the sidebar for a host-runtime probe tick with no content change", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      const probeByConnectionId = getHostController().getSnapshot().probeByConnectionId;
      updateControllerSnapshot({
        probeByConnectionId: new Map(probeByConnectionId),
      });
    });

    expect(counts).toEqual({
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    });
  });

  it("updates active selection probes from the active workspace route", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/a-one`;
    });
    ({ root, container } = await renderProbe(counts));

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/b-two`;
      if (root) {
        renderSidebarFrame(root, counts);
      }
    });

    expect(counts.frame).toBe(1);
    expect(counts.projectSelection).toEqual({
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-a" })]: 1,
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-b" })]: 1,
    });
    expect(counts.rowSelection).toEqual({
      "a-main": 1,
      "a-one": 1,
      "a-two": 1,
      "b-main": 1,
      "b-one": 1,
      "b-two": 1,
    });
  });
});

describe("sidebar workspace menu items", () => {
  afterEach(() => {
    cleanup();
  });

  it("workspace menu no longer includes project/directory actions", () => {
    render(<SidebarWorkspaceMenu workspaceKey="test-wk" onArchive={vi.fn()} open />);

    expect(screen.queryByText("Copy path")).toBeNull();
    expect(screen.queryByText("Copy branch name")).toBeNull();
    expect(screen.queryByText("Open in file manager")).toBeNull();
    expect(screen.getByTestId("sidebar-workspace-menu-archive-test-wk")).toBeTruthy();
  });

  it("member menu starts an agent or terminal in the project, and keeps the copy actions", () => {
    render(
      <WorkspaceMemberMenuItems
        member={testMember}
        serverId={SERVER_ID}
        workspaceId={WORKSPACE_ID}
        surface="context"
        canRemove
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("sidebar-member-menu-new-agent-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("sidebar-member-menu-new-terminal-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("sidebar-member-menu-copy-path-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
    expect(screen.queryByText("Copy branch name")).toBeNull();
    expect(
      screen.getByTestId("sidebar-member-menu-open-folder-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("sidebar-member-menu-remove-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
  });

  it("member menu keeps copy actions but hides remove when removal is not allowed", () => {
    render(
      <WorkspaceMemberMenuItems
        member={testMember}
        serverId={SERVER_ID}
        workspaceId={WORKSPACE_ID}
        surface="context"
        canRemove={false}
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("sidebar-member-menu-copy-path-test-wk#/repo/project-a/main"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("sidebar-member-menu-remove-test-wk#/repo/project-a/main"),
    ).toBeNull();
  });
});
