/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarWorkspaceAgentRow } from "@/projects/workspace-groups";

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

vi.mock("expo-router", () => ({
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
  router: { dismissTo: vi.fn(), push: vi.fn(), navigate: vi.fn() },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn(),
}));

vi.mock("@/components/ui/context-menu", () => {
  const ReactMock = require("react") as typeof import("react");
  const StubItem = ({
    children,
    testID,
    disabled,
  }: {
    children?: React.ReactNode;
    testID?: string;
    disabled?: boolean;
  }) =>
    ReactMock.createElement(
      "button",
      { "data-testid": testID, disabled, type: "button" },
      children,
    );
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
    DropdownMenuContent: () => null,
    DropdownMenuItem: StubItem,
    DropdownMenuTrigger: StubItem,
    DropdownMenuSubTrigger: StubItem,
    DropdownMenuSeparator: () => null,
  };
});

vi.mock("@/components/workspace-hover-card", () => ({
  AgentHoverCard: ({ children }: { children: React.ReactNode }) => children,
}));

import { WorkspaceAgentRow } from "@/components/sidebar/workspace-agent-row";
import { WorkspaceAgentMenuItems } from "@/components/sidebar/workspace-member-menu";
import { APP_SETTINGS_QUERY_KEY, DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import { checkoutStatusQueryKey } from "@/git/query-keys";
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({
    error: vi.fn(),
    copied: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const AGENT: SidebarWorkspaceAgentRow = {
  agentId: "agent-1",
  title: "Fix the sidebar",
  cwd: "/repo/project",
  cwdLabel: "~/project",
  matchesMemberDirectory: true,
  labels: [],
  statusBucket: "done",
  lastActivityAt: new Date(1_000),
};

function renderRow(input: {
  branch?: string | null;
  diffStat?: { additions: number; deletions: number } | null;
  showBranchItem?: boolean;
  trailing?: "diff" | "timestamp" | "none";
}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, {
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarRowItems: {
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      branch: input.showBranchItem ?? false,
    },
    sidebarWorkspaceTrailing: input.trailing ?? "diff",
  });
  if (input.branch !== undefined) {
    queryClient.setQueryData(checkoutStatusQueryKey("srv", AGENT.cwd), {
      isGit: true,
      currentBranch: input.branch,
    });
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceAgentRow
        agent={AGENT}
        diffStat={input.diffStat ?? null}
        prHint={null}
        serverId="srv"
        workspaceId="ws-1"
      />
    </QueryClientProvider>,
  );
}

describe("WorkspaceAgentRow branch and diff", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the member's diff under the default trailing preference", () => {
    renderRow({ diffStat: { additions: 12, deletions: 3 } });

    expect(screen.getByTestId("sidebar-agent-diff-agent-1")).toBeTruthy();
  });

  it("hides the diff when the trailing slot is not set to diff", () => {
    renderRow({ diffStat: { additions: 12, deletions: 3 }, trailing: "none" });

    expect(screen.queryByTestId("sidebar-agent-diff-agent-1")).toBeNull();
  });

  it("hides the diff when the member has no live diff", () => {
    renderRow({ diffStat: null });

    expect(screen.queryByTestId("sidebar-agent-diff-agent-1")).toBeNull();
  });

  it("shows the agent checkout branch only when the branch row item is on", () => {
    const { unmount } = renderRow({ branch: "feature/sidebar" });
    expect(screen.queryByTestId("sidebar-agent-branch-agent-1")).toBeNull();
    expect(screen.getByTestId("sidebar-agent-menu-copy-branch-agent-1")).toBeTruthy();
    unmount();

    renderRow({ branch: "feature/sidebar", showBranchItem: true });
    expect(screen.getByTestId("sidebar-agent-branch-agent-1")).toBeTruthy();
  });

  it("keeps a cached branch action mounted but disables it while the branch refreshes", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceAgentMenuItems
          agent={AGENT}
          serverId="srv"
          branch="feature/sidebar"
          branchPending
          surface="context"
          onOpen={vi.fn()}
          onCopyPath={vi.fn()}
          onCopyBranchName={vi.fn()}
          onArchive={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(
      (screen.getByTestId("sidebar-agent-menu-copy-branch-agent-1") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the status dot and title regardless of checkout facts", () => {
    renderRow({});

    expect(screen.getByTestId("sidebar-agent-status-done")).toBeTruthy();
    expect(screen.getByText("Fix the sidebar")).toBeTruthy();
  });

  it("renders the agent context menu with Open agent and Archive agent items", () => {
    renderRow({});

    expect(screen.getByTestId("sidebar-agent-menu-open-agent-1")).toBeTruthy();
    expect(screen.getByTestId("sidebar-agent-menu-labels-agent-1")).toBeTruthy();
    expect(screen.getByTestId("sidebar-agent-menu-archive-agent-1")).toBeTruthy();
  });
});
