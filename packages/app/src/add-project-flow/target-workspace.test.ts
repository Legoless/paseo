import { describe, expect, it } from "vitest";
import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import { resolveAddProjectTargetWorkspace } from "./target-workspace";

function placement(workspaceId: string, serverId = "host-a"): SidebarWorkspacePlacement {
  return {
    workspaceKey: `${serverId}:${workspaceId}`,
    serverId,
    workspaceId,
    projectViewKey: "",
    projectName: "",
    projectKind: "non_git",
    workspaceKind: "directory",
    name: workspaceId,
  };
}

describe("resolveAddProjectTargetWorkspace", () => {
  it("adds into the open workspace", () => {
    expect(
      resolveAddProjectTargetWorkspace({
        activeSelection: { serverId: "host-b", workspaceId: "wks-open" },
        pinnedWorkspaces: [placement("wks-pinned")],
        topLevelWorkspaces: [placement("wks-first")],
      }),
    ).toEqual({ serverId: "host-b", workspaceId: "wks-open" });
  });

  it("falls back to the topmost row, which is a pinned one when any is pinned", () => {
    expect(
      resolveAddProjectTargetWorkspace({
        activeSelection: null,
        pinnedWorkspaces: [placement("wks-pinned"), placement("wks-pinned-2")],
        topLevelWorkspaces: [placement("wks-first")],
      }),
    ).toEqual({ serverId: "host-a", workspaceId: "wks-pinned" });
  });

  it("falls back to the first top-level row when nothing is pinned", () => {
    expect(
      resolveAddProjectTargetWorkspace({
        activeSelection: null,
        pinnedWorkspaces: [],
        topLevelWorkspaces: [placement("wks-first"), placement("wks-second")],
      }),
    ).toEqual({ serverId: "host-a", workspaceId: "wks-first" });
  });

  // No workspace to join means the flow registers a standalone project instead.
  it("answers null when the sidebar has no workspace at all", () => {
    expect(
      resolveAddProjectTargetWorkspace({
        activeSelection: null,
        pinnedWorkspaces: [],
        topLevelWorkspaces: [],
      }),
    ).toBeNull();
  });
});
