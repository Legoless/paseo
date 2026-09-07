import { describe, expect, it, vi } from "vitest";
import {
  createExternalDndListRegistry,
  type ExternalDndListRegistration,
} from "./external-dnd-registry";

interface Row {
  id: string;
}

function committedIds(commit: ReturnType<typeof vi.fn>): string[] | undefined {
  const committed = commit.mock.calls[0]?.[0] as Row[] | undefined;
  return committed?.map((row) => row.id);
}

function registerRows(
  registry: ReturnType<typeof createExternalDndListRegistry>,
  listId: string,
  ids: string[],
) {
  const commit = vi.fn();
  const rows = ids.map((id) => ({ id }));
  registry.registerList(listId, {
    getData: () => rows,
    keyExtractor: (item) => (item as Row).id,
    commit,
  });
  return { commit, rows };
}

describe("createExternalDndListRegistry", () => {
  it("reorders the list that owns the dragged row and commits through its callback", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    const { commit } = registerRows(registry, "members:wks-a", ["a", "b", "c"]);

    registry.reorderSameList({ listId: "members:wks-a", activeId: "c", overId: "a" });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(committedIds(commit)).toEqual(["c", "a", "b"]);
  });

  it("routes to the named list only, leaving every sibling list alone", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    const first = registerRows(registry, "agents:wks-a#/repo/one", ["a", "b"]);
    const second = registerRows(registry, "agents:wks-b#/repo/one", ["x", "y"]);

    registry.reorderSameList({
      listId: "agents:wks-a#/repo/one",
      activeId: "b",
      overId: "a",
    });

    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown list id", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    const { commit } = registerRows(registry, "workspaces", ["a", "b"]);

    registry.reorderSameList({ listId: "members:gone", activeId: "a", overId: "b" });

    expect(commit).not.toHaveBeenCalled();
  });

  it("does not commit when the row was dropped on itself or outside any row", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    const { commit } = registerRows(registry, "workspaces", ["a", "b"]);

    registry.reorderSameList({ listId: "workspaces", activeId: "a", overId: "a" });
    registry.reorderSameList({ listId: "workspaces", activeId: "a", overId: null });

    expect(commit).not.toHaveBeenCalled();
  });

  it("stops routing to a list once it unregisters", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    const { commit } = registerRows(registry, "workspaces", ["a", "b"]);

    registry.unregisterList("workspaces");
    registry.reorderSameList({ listId: "workspaces", activeId: "b", overId: "a" });

    expect(commit).not.toHaveBeenCalled();
  });

  it("reads the list's data at drop time, not at registration time", () => {
    const lists = new Map<string, ExternalDndListRegistration>();
    const registry = createExternalDndListRegistry(lists);
    let rows: Row[] = [{ id: "a" }, { id: "b" }];
    const commit = vi.fn();
    registry.registerList("workspaces", {
      getData: () => rows,
      keyExtractor: (item) => (item as Row).id,
      commit,
    });

    // A workspace arrived after the list registered; the drop must see it.
    rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    registry.reorderSameList({ listId: "workspaces", activeId: "c", overId: "a" });

    expect(committedIds(commit)).toEqual(["c", "a", "b"]);
  });
});
