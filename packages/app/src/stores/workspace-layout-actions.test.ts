import { describe, expect, it } from "vitest";
import {
  collectAllTabs,
  createDefaultLayout,
  reconcileWorkspaceTabs,
  type WorkspaceTabSnapshot,
} from "@/stores/workspace-layout-actions";

function hydratedEmptySnapshot(): WorkspaceTabSnapshot {
  return {
    agentsHydrated: true,
    terminalsHydrated: true,
    activeAgentIds: [],
    autoOpenAgentIds: [],
    knownAgentIds: [],
    knownTerminalIds: [],
    standaloneTerminalIds: [],
  };
}

describe("reconcileWorkspaceTabs on an empty workspace", () => {
  // An empty workspace used to get a draft composer seeded into it, and closing that draft read
  // as freshly empty, so the composer came straight back. The workspace must stay empty: the
  // launcher its pane already holds is the offered starting point.
  it("leaves the launcher in place instead of opening a draft", () => {
    const reconciled = reconcileWorkspaceTabs(
      { layout: createDefaultLayout(), explorerSidebarPaneId: null },
      hydratedEmptySnapshot(),
    );

    expect(collectAllTabs(reconciled.layout.root).map((tab) => tab.target.kind)).toEqual([
      "new_tab",
    ]);
  });
});
