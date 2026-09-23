import { beforeEach, describe, expect, it } from "vitest";
import {
  computeSidebarOrderUpdates,
  type SidebarProjectEntry,
} from "@/hooks/sidebar-workspaces-view-model";
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

// A directory whose name ends in a space produces a view key that ends in a
// space. Trimming it on write used to make the sidebar's reconcile effect loop
// forever, crashing the app with React error #185 (see #4880).
describe("sidebar order keys that end in whitespace", () => {
  const PROJECT_KEY = "host:srv-1:/home/u/Reklamation ";

  beforeEach(() => {
    useSidebarOrderStore.setState({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
    });
  });

  it("stores a project key exactly as given", () => {
    useSidebarOrderStore.getState().setProjectOrder([PROJECT_KEY]);

    expect(useSidebarOrderStore.getState().projectOrder).toEqual([PROJECT_KEY]);
  });

  it("scopes a workspace order under the project key the sidebar indexes by", () => {
    useSidebarOrderStore.getState().setWorkspaceOrder(PROJECT_KEY, ["srv-1:main"]);

    // use-sidebar-workspaces-list reads workspaceOrderByProject by view key
    // directly, so the scope has to be stored under that same key.
    expect(useSidebarOrderStore.getState().workspaceOrderByProject[PROJECT_KEY]).toEqual([
      "srv-1:main",
    ]);
    expect(useSidebarOrderStore.getState().getWorkspaceOrder(PROJECT_KEY)).toEqual(["srv-1:main"]);
  });

  it("settles the sidebar order reconcile instead of rewriting it forever", () => {
    const projects: SidebarProjectEntry[] = [
      {
        viewKey: PROJECT_KEY,
        projectName: "Reklamation ",
        projectKind: "non_git",
        iconWorkingDir: "/home/u/Reklamation ",
        hosts: [],
        workspaces: [],
      },
    ];
    const runPass = () =>
      computeSidebarOrderUpdates({
        projects,
        persistedProjectOrder: useSidebarOrderStore.getState().projectOrder,
        getWorkspaceOrder: (key) => useSidebarOrderStore.getState().getWorkspaceOrder(key),
      });

    // First pass adds the newly visible project.
    const first = runPass();
    expect(first.projectOrder).toEqual([PROJECT_KEY]);
    useSidebarOrderStore.getState().setProjectOrder(first.projectOrder ?? []);

    // Second pass must find nothing left to do; otherwise the effect that
    // applies these updates re-runs on every render.
    expect(runPass().projectOrder).toBeNull();
  });

  it("round-trips member and agent orders under a member key that ends in a space", () => {
    const memberKey = "srv:wks-a#/home/u/Reklamation ";
    useSidebarOrderStore.setState({ memberOrderByWorkspace: {}, agentOrderByMember: {} });
    const store = useSidebarOrderStore.getState();

    store.setMemberOrder("srv:wks-a", [memberKey, memberKey]);
    store.setAgentOrder(memberKey, ["agent:2", "agent:1"]);

    // The sidebar indexes both maps by the raw key (sidebar-workspace-list.tsx).
    const next = useSidebarOrderStore.getState();
    expect(next.memberOrderByWorkspace["srv:wks-a"]).toEqual([memberKey]);
    expect(next.agentOrderByMember[memberKey]).toEqual(["agent:2", "agent:1"]);
  });

  it("carries an agent order between member keys that end in a space", () => {
    const from = "srv:wks-a#/home/u/Reklamation ";
    const to = "srv:wks-b#/home/u/Reklamation ";
    useSidebarOrderStore.setState({ agentOrderByMember: {} });
    useSidebarOrderStore.getState().setAgentOrder(from, ["agent:1"]);

    useSidebarOrderStore.getState().rekeyAgentOrder(from, to);

    expect(useSidebarOrderStore.getState().agentOrderByMember).toEqual({ [to]: ["agent:1"] });
  });

  it("still trims keys when migrating persisted state", () => {
    const migrated = migrateSidebarOrderState({
      projectOrder: [" host-a:one ", "host-a:one"],
    });

    expect(migrated.projectOrder).toEqual(["host-a:one"]);
  });
});
