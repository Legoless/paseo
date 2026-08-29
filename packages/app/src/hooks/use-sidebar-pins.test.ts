import { describe, expect, it } from "vitest";
import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";

function placement(workspaceKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey,
    serverId: "s1",
    workspaceId: workspaceKey,
    projectViewKey: "p1",
    projectName: "Project 1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceKey,
  };
}

describe("splitPinnedSidebarGroups", () => {
  it("returns every workspace unpinned when nothing is pinned", () => {
    const workspaces = [placement("w1"), placement("w2")];
    const result = splitPinnedSidebarGroups({
      workspaces,
      keys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
      pinnedWorkspaceOrder: [],
    });

    expect(result.pinnedChats).toEqual([]);
    expect(result.unpinnedWorkspaces.map((w) => w.workspaceKey)).toEqual(["w1", "w2"]);
  });

  it("hoists pinned chats out of the unpinned list", () => {
    const result = splitPinnedSidebarGroups({
      workspaces: [placement("w1"), placement("w2")],
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
      pinnedWorkspaceOrder: [],
    });

    expect(result.pinnedChats.map((w) => w.workspaceKey)).toEqual(["w1"]);
    expect(result.unpinnedWorkspaces.map((w) => w.workspaceKey)).toEqual(["w2"]);
  });

  it("orders pinned chats by most-recently-pinned first", () => {
    const result = splitPinnedSidebarGroups({
      workspaces: [placement("older"), placement("newer")],
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: [],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("applies the saved order while keeping a newly pinned chat first", () => {
    const result = splitPinnedSidebarGroups({
      workspaces: [placement("older"), placement("newer"), placement("new")],
      keys: {
        pinnedWorkspaceKeys: ["older", "newer", "new"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
          new: "2026-03-01T00:00:00Z",
        },
      },
      pinnedWorkspaceOrder: ["older", "newer"],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "new",
      "older",
      "newer",
    ]);
  });
});
