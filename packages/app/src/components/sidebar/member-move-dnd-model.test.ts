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
/** The same project as memberA1, mounted in the other workspace — R3's move target. */
const memberB_one: SidebarDndItemData = {
  kind: "member",
  workspaceKey: "srv1:wks-b",
  memberKey: "srv1:wks-b#/repo/one",
  cwd: "/repo/one",
  projectName: "one",
  label: "one",
};
const agentA1: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/one",
  cwd: "/repo/one",
  agentId: "agent-1",
  label: "First agent",
};
const agentA2: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/one",
  cwd: "/repo/one",
  agentId: "agent-2",
  label: "Second agent",
};
/** An agent under a different project in the same workspace. */
const agentA_two: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/two",
  cwd: "/repo/two",
  agentId: "agent-3",
  label: "Other project agent",
};
/** An agent under the same project in the other workspace. */
const agentB_one: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-b",
  memberKey: "srv1:wks-b#/repo/one",
  cwd: "/repo/one",
  agentId: "agent-4",
  label: "Mirror agent",
};
const uncategorizedB: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-b",
  memberKey: "srv1:wks-b#uncategorized",
  cwd: "",
  agentId: "agent-5",
  label: "Loose agent",
};
/** A composer draft: no daemon-side agent exists yet, so it can only reorder. */
const draftA: SidebarDndItemData = {
  kind: "agent",
  workspaceKey: "srv1:wks-a",
  memberKey: "srv1:wks-a#/repo/one",
  cwd: "/repo/one",
  agentId: null,
  label: "New agent",
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
        // A bare workspace row names no slot, so the move appends.
        targetMemberKey: null,
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
        // The row it landed on, so the drop position survives the daemon's append.
        targetMemberKey: "srv1:wks-b#/repo/three",
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

describe("routeSidebarDragEnd: workspace rows", () => {
  it("does nothing when a workspace lands on a member row", () => {
    expect(
      routeSidebarDragEnd({ active: workspaceA, over: memberB1, overId: memberB1.memberKey }),
    ).toEqual({ kind: "none" });
  });

  it("does nothing when a workspace lands on an agent row", () => {
    expect(
      routeSidebarDragEnd({ active: workspaceA, over: agentB_one, overId: "agent-4" }),
    ).toEqual({ kind: "none" });
  });
});

describe("routeSidebarDragEnd: agent reorder (R3)", () => {
  it("reorders the bucket when an agent lands on a sibling under the same project", () => {
    expect(routeSidebarDragEnd({ active: agentA1, over: agentA2, overId: "agent-2" })).toEqual({
      kind: "reorder",
      listId: "agents:srv1:wks-a#/repo/one",
    });
  });

  it("reorders when a draft row lands on a sibling, since reordering needs no daemon call", () => {
    expect(routeSidebarDragEnd({ active: draftA, over: agentA1, overId: "agent-1" })).toEqual({
      kind: "reorder",
      listId: "agents:srv1:wks-a#/repo/one",
    });
  });

  it("does nothing when an agent lands on its own project's row", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: memberA1, overId: memberA1.memberKey }),
    ).toEqual({ kind: "none" });
  });
});

describe("routeSidebarDragEnd: agent stays inside its project (R3)", () => {
  it("refuses another project's bucket in the same workspace", () => {
    expect(routeSidebarDragEnd({ active: agentA1, over: agentA_two, overId: "agent-3" })).toEqual({
      kind: "none",
    });
  });

  it("refuses another project's row in the same workspace", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: memberA2, overId: memberA2.memberKey }),
    ).toEqual({ kind: "none" });
  });

  it("refuses a different project's bucket in another workspace", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: memberB1, overId: memberB1.memberKey }),
    ).toEqual({ kind: "none" });
  });

  it("refuses the uncategorized bucket, which names no project", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: uncategorizedB, overId: "agent-5" }),
    ).toEqual({ kind: "none" });
  });

  it("refuses a bare workspace row, which names no project to land in", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: workspaceB, overId: "srv1:wks-b" }),
    ).toEqual({ kind: "none" });
  });

  it("refuses to move a draft row across workspaces — there is no agent to re-parent", () => {
    expect(
      routeSidebarDragEnd({ active: draftA, over: memberB_one, overId: memberB_one.memberKey }),
    ).toEqual({ kind: "none" });
  });
});

describe("routeSidebarDragEnd: agent moves to the same project elsewhere (R3)", () => {
  it("moves onto the same project's row in another workspace", () => {
    expect(
      routeSidebarDragEnd({ active: agentA1, over: memberB_one, overId: memberB_one.memberKey }),
    ).toEqual({
      kind: "moveAgent",
      input: {
        agentId: "agent-1",
        sourceWorkspaceKey: "srv1:wks-a",
        targetWorkspaceKey: "srv1:wks-b",
        sourceMemberKey: "srv1:wks-a#/repo/one",
        targetMemberKey: "srv1:wks-b#/repo/one",
        label: "First agent",
      },
    });
  });

  it("moves onto an agent already under the same project in another workspace", () => {
    expect(routeSidebarDragEnd({ active: agentA1, over: agentB_one, overId: "agent-4" })).toEqual({
      kind: "moveAgent",
      input: {
        agentId: "agent-1",
        sourceWorkspaceKey: "srv1:wks-a",
        targetWorkspaceKey: "srv1:wks-b",
        sourceMemberKey: "srv1:wks-a#/repo/one",
        targetMemberKey: "srv1:wks-b#/repo/one",
        label: "First agent",
      },
    });
  });

  it("does nothing when the drag ends outside any row", () => {
    expect(routeSidebarDragEnd({ active: agentA1, over: null, overId: null })).toEqual({
      kind: "none",
    });
  });
});
