import { describe, expect, it } from "vitest";
import {
  collectAllTabs,
  createDefaultLayout,
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
});
