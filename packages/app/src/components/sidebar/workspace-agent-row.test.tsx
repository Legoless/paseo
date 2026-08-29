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

import { WorkspaceAgentRow } from "@/components/sidebar/workspace-agent-row";
import { APP_SETTINGS_QUERY_KEY, DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";

const AGENT: SidebarWorkspaceAgentRow = {
  agentId: "agent-1",
  title: "Fix the sidebar",
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
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceAgentRow
        agent={AGENT}
        branch={input.branch ?? null}
        diffStat={input.diffStat ?? null}
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

  it("shows the member's branch only when the branch row item is on", () => {
    const { unmount } = renderRow({ branch: "feature/sidebar" });
    expect(screen.queryByTestId("sidebar-agent-branch-agent-1")).toBeNull();
    unmount();

    renderRow({ branch: "feature/sidebar", showBranchItem: true });
    expect(screen.getByTestId("sidebar-agent-branch-agent-1")).toBeTruthy();
  });

  it("keeps the status dot and title regardless of checkout facts", () => {
    renderRow({});

    expect(screen.getByTestId("sidebar-agent-status-done")).toBeTruthy();
    expect(screen.getByText("Fix the sidebar")).toBeTruthy();
  });
});
