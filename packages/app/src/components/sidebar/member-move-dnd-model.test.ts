import { describe, expect, it } from "vitest";
import { routeSidebarDragEnd, type SidebarDndItemData } from "./member-move-dnd-model";

const workspaceA: SidebarDndItemData = {
  kind: "workspace",
  workspaceKey: "srv1:wks-a",
  label: "Main",
};
const workspaceB: SidebarDndItemData = {
  kind: "workspace",
  workspaceKey: "srv1:wks-b",
  label: "Secondary",
};
const memberA1: SidebarDndItemData = {
  kind: "member",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/one",
  cwd: "/repo/one",
  projectName: "one",
  label: "one",
};
const memberA2: SidebarDndItemData = {
  kind: "member",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/two",
  cwd: "/repo/two",
  projectName: "two",
  label: "two",
};
const memberB1: SidebarDndItemData = {
  kind: "member",
  workspaceKey: "srv1:wks-b",
  memberKey: "srv1:wks-b#/repo/three",
  cwd: "/repo/three",
  projectName: "three",
  label: "three",
};

describe("routeSidebarDragEnd", () => {
  it("reorders the workspace list when a workspace lands on another workspace", () => {
    expect(
      routeSidebarDragEnd({ active: workspaceA, over: workspaceB, overId: "srv1:wks-b" }),
    ).toEqual({ kind: "reorder", listId: "workspaces" });
  });

  it("reorders the member's own list when it lands on a sibling member", () => {
    expect(
      routeSidebarDragEnd({ active: memberA1, over: memberA2, overId: memberA2.memberKey }),
    ).toEqual({ kind: "reorder", listId: "members:srv1:wks-a" });
  });

  it("moves the member when it lands on another workspace's row", () => {
    expect(
      routeSidebarDragEnd({ active: memberA1, over: workspaceB, overId: "srv1:wks-b" }),
    ).toEqual({
      kind: "move",
      input: {
        sourceWorkspaceKey: "srv1:wks-a",
        targetWorkspaceKey: "srv1:wks-b",
        cwd: "/repo/one",
        projectName: "one",
      },
    });
  });

  it("moves the member when it lands on another workspace's member", () => {
    expect(
      routeSidebarDragEnd({ active: memberA1, over: memberB1, overId: memberB1.memberKey }),
    ).toEqual({
      kind: "move",
      input: {
        sourceWorkspaceKey: "srv1:wks-a",
        targetWorkspaceKey: "srv1:wks-b",
        cwd: "/repo/one",
        projectName: "one",
      },
    });
  });

  it("does nothing when a member lands on its own workspace row", () => {
    expect(
      routeSidebarDragEnd({ active: memberA1, over: workspaceA, overId: "srv1:wks-a" }),
    ).toEqual({
      kind: "none",
    });
  });

  it("does nothing when the drag ends outside any row or without data", () => {
    expect(routeSidebarDragEnd({ active: memberA1, over: null, overId: null })).toEqual({
      kind: "none",
    });
    expect(routeSidebarDragEnd({ active: null, over: workspaceB, overId: "srv1:wks-b" })).toEqual({
      kind: "none",
    });
  });
});
