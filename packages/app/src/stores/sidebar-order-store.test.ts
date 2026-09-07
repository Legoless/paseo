/**
 * jsdom: the store's persist middleware writes through AsyncStorage, which needs `window`.
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { migrateSidebarOrderState, useSidebarOrderStore } from "./sidebar-order-store";

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

describe("rekeyAgentOrder", () => {
  beforeEach(() => {
    useSidebarOrderStore.setState({ agentOrderByMember: {} });
  });

  it("carries a bucket's agent order to the key the move renames it to", () => {
    const store = useSidebarOrderStore.getState();
    store.setAgentOrder("srv:wks-a#/repo/one", ["agent:2", "agent:1"]);

    store.rekeyAgentOrder("srv:wks-a#/repo/one", "srv:wks-b#/repo/one");

    const next = useSidebarOrderStore.getState();
    // The old bucket is gone rather than left to leak, and the drop order survived.
    expect(next.getAgentOrder("srv:wks-a#/repo/one")).toEqual([]);
    expect(next.getAgentOrder("srv:wks-b#/repo/one")).toEqual(["agent:2", "agent:1"]);
    expect(Object.keys(next.agentOrderByMember)).toEqual(["srv:wks-b#/repo/one"]);
  });

  it("leaves the target untouched when the source bucket never had an order", () => {
    const store = useSidebarOrderStore.getState();
    store.setAgentOrder("srv:wks-b#/repo/one", ["agent:9"]);

    store.rekeyAgentOrder("srv:wks-a#/repo/one", "srv:wks-b#/repo/one");

    expect(useSidebarOrderStore.getState().getAgentOrder("srv:wks-b#/repo/one")).toEqual([
      "agent:9",
    ]);
  });

  it("ignores a no-op rename and blank keys", () => {
    const store = useSidebarOrderStore.getState();
    store.setAgentOrder("srv:wks-a#/repo/one", ["agent:1"]);

    store.rekeyAgentOrder("srv:wks-a#/repo/one", "srv:wks-a#/repo/one");
    store.rekeyAgentOrder("srv:wks-a#/repo/one", "  ");

    expect(useSidebarOrderStore.getState().getAgentOrder("srv:wks-a#/repo/one")).toEqual([
      "agent:1",
    ]);
  });
});
