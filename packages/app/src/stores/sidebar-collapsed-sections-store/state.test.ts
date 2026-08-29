import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  togglePinnedCollapsed,
  toggleProjectCollapsed,
  toggleWorkspaceCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedWorkspaceKeys: new Set(),
    collapsedPinned: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("tracks collapsed workspace keys independently of project and group keys", () => {
    let state = emptyState();

    state = toggleWorkspaceCollapsed(state, "srv:ws-1");
    state = toggleWorkspaceCollapsed(state, "srv:ws-2");
    state = toggleWorkspaceCollapsed(state, "srv:ws-1");

    expect(Array.from(state.collapsedWorkspaceKeys)).toEqual(["srv:ws-2"]);
    expect(Array.from(state.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedWorkspaceKeys: new Set(["srv:ws-1"]),
      collapsedPinned: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedWorkspaceKeys: ["srv:ws-1"],
      collapsedPinned: true,
    });
  });

  it("restores collapsed workspace keys persisted by a newer build", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedWorkspaceKeys: ["srv:ws-1", "srv:ws-2"] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedWorkspaceKeys)).toEqual(["srv:ws-1", "srv:ws-2"]);
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
    expect(mergePersistedCollapsedProjects({ collapsedWorkspaceKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
