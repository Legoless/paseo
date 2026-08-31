import { describe, expect, it } from "vitest";
import { migrateSidebarOrderState } from "./sidebar-order-store";

describe("migrateSidebarOrderState", () => {
  it("prefixes legacy per-server workspace order with the source server id", () => {
    const migrated = migrateSidebarOrderState({
      projectOrderByServerId: {
        "host-a": ["project-a"],
        "host-b": ["project-a"],
      },
      workspaceOrderByServerAndProject: {
        "host-a::project-a": ["main", "feature"],
        "host-b::project-a": ["main"],
      },
    });

    expect(migrated).toEqual({
      projectOrder: ["project-a"],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {
        "project-a": ["host-a:main", "host-a:feature", "host-b:main"],
      },
      workspaceOrder: [],
      memberOrderByWorkspace: {},
      agentOrderByMember: {},
    });
  });

  it("normalizes pinned workspace order", () => {
    const migrated = migrateSidebarOrderState({
      pinnedWorkspaceOrder: [" host-a:one ", "host-a:one", "", "host-b:two"],
    });

    expect(migrated.pinnedWorkspaceOrder).toEqual(["host-a:one", "host-b:two"]);
  });

  it("defaults the flat workspace order when the persisted state predates it", () => {
    const migrated = migrateSidebarOrderState({
      projectOrder: ["project-a"],
      workspaceOrderByProject: { "project-a": ["srv:ws-1"] },
    });

    expect(migrated.workspaceOrder).toEqual([]);
  });

  it("restores the flat workspace order and normalizes its keys", () => {
    const migrated = migrateSidebarOrderState({
      workspaceOrder: ["srv:ws-1", " srv:ws-2 ", "srv:ws-1", ""],
    });

    expect(migrated.workspaceOrder).toEqual(["srv:ws-1", "srv:ws-2"]);
  });

  it("restores member and agent orders within their scopes", () => {
    const migrated = migrateSidebarOrderState({
      memberOrderByWorkspace: { " srv:workspace ": [" member-b ", "member-a"] },
      agentOrderByMember: { " member-a ": ["agent:two", "agent:one", "agent:two"] },
    });

    expect(migrated.memberOrderByWorkspace).toEqual({
      "srv:workspace": ["member-b", "member-a"],
    });
    expect(migrated.agentOrderByMember).toEqual({
      "member-a": ["agent:two", "agent:one"],
    });
  });

  it("rejects malformed persisted state wholesale", () => {
    expect(migrateSidebarOrderState({ workspaceOrder: [42] })).toEqual({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      workspaceOrder: [],
      memberOrderByWorkspace: {},
      agentOrderByMember: {},
    });
  });
});
