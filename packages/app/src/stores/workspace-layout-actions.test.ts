import { describe, expect, it } from "vitest";
import {
  closeTabInLayout,
  collectAllTabs,
  createDefaultLayout,
  DEFAULT_PANE_ID,
  reconcileWorkspaceTabs,
  type WorkspaceTabSnapshot,
} from "@/stores/workspace-layout-actions";

function hydratedEmptySnapshot(
  overrides: Partial<WorkspaceTabSnapshot> = {},
): WorkspaceTabSnapshot {
  return {
    agentsHydrated: true,
    terminalsHydrated: true,
    activeAgentIds: [],
    autoOpenAgentIds: [],
    knownAgentIds: [],
    knownTerminalIds: [],
    standaloneTerminalIds: [],
    ...overrides,
  };
}

describe("reconcileWorkspaceTabs draft seeding", () => {
  it("seeds a draft into an empty workspace that holds a project", () => {
    const reconciled = reconcileWorkspaceTabs(
      { layout: createDefaultLayout(), explorerSidebarPaneId: null },
      hydratedEmptySnapshot(),
    );

    expect(collectAllTabs(reconciled.layout.root).map((tab) => tab.target.kind)).toEqual(["draft"]);
  });

  it("leaves the launcher in place for a projectless workspace", () => {
    const reconciled = reconcileWorkspaceTabs(
      { layout: createDefaultLayout(), explorerSidebarPaneId: null },
      hydratedEmptySnapshot({ isProjectless: true }),
    );

    expect(collectAllTabs(reconciled.layout.root).map((tab) => tab.target.kind)).toEqual([
      "new_tab",
    ]);
  });

  // Closing the seeded draft used to be indistinguishable from nothing happening: the pane it
  // left behind holds a `new_tab`, which does not count as content, so the next reconcile pass
  // seeded another draft with a fresh id.
  it("does not seed another draft after the user closes the seeded one", () => {
    const seeded = reconcileWorkspaceTabs(
      { layout: createDefaultLayout(), explorerSidebarPaneId: null },
      hydratedEmptySnapshot(),
    );
    const draftTab = collectAllTabs(seeded.layout.root).find((tab) => tab.target.kind === "draft");
    expect(draftTab).toBeDefined();

    const closed = closeTabInLayout({
      layout: seeded.layout,
      tabId: draftTab?.tabId ?? "",
      preserveEmptyPaneId: DEFAULT_PANE_ID,
    });
    expect(closed).not.toBeNull();

    const reconciled = reconcileWorkspaceTabs(
      { layout: closed ?? seeded.layout, explorerSidebarPaneId: null },
      hydratedEmptySnapshot(),
    );

    expect(collectAllTabs(reconciled.layout.root).map((tab) => tab.target.kind)).toEqual([
      "new_tab",
    ]);
  });
});
