import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { hasSidebarWorkspaceTrailing } from "./index";

function workspace(overrides: Partial<SidebarWorkspaceEntry> = {}): SidebarWorkspaceEntry {
  return {
    workspaceKey: "srv:ws-1",
    serverId: "srv",
    workspaceId: "ws-1",
    projectViewKey: "project",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "ws-1",
    workspaceDirectory: "/repo/ws-1",
    workspaceDirectoryLabel: "ws-1",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: { additions: 12, deletions: 3 },
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels: [],
    ...overrides,
  };
}

describe("hasSidebarWorkspaceTrailing", () => {
  it("never draws a workspace row's diff — the diff lives on the agent rows now", () => {
    expect(hasSidebarWorkspaceTrailing({ workspace: workspace(), trailing: "diff" })).toBe(false);
  });

  it("still draws the timestamp when the workspace has entered a status", () => {
    const entered = workspace({ statusEnteredAt: new Date("2026-08-01T00:00:00Z") });
    expect(hasSidebarWorkspaceTrailing({ workspace: entered, trailing: "timestamp" })).toBe(true);
    expect(hasSidebarWorkspaceTrailing({ workspace: workspace(), trailing: "timestamp" })).toBe(
      false,
    );
  });

  it("draws nothing when the slot is off", () => {
    expect(hasSidebarWorkspaceTrailing({ workspace: workspace(), trailing: "none" })).toBe(false);
  });
});
