import { describe, expect, it } from "vitest";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import {
  collectAllTabs,
  createDefaultLayout,
  findPaneContainingTab,
  reconcileWorkspaceTabs,
  type SplitNode,
  type WorkspaceLayout,
  type WorkspaceTabSnapshot,
} from "@/stores/workspace-layout-actions";

function hydratedEmptySnapshot(): WorkspaceTabSnapshot {
  return {
    agentsHydrated: true,
    terminalsHydrated: true,
    activeAgentIds: [],
    autoOpenAgentIds: [],
    knownTerminalIds: [],
    standaloneTerminalIds: [],
  };
}

function agentTab(agentId: string): WorkspaceTab {
  return {
    tabId: `agent_${agentId}`,
    target: { kind: "agent", agentId },
    createdAt: 1,
  };
}

function terminalTab(terminalId: string): WorkspaceTab {
  return {
    tabId: `terminal_${terminalId}`,
    target: { kind: "terminal", terminalId },
    createdAt: 1,
  };
}

function launcherTab(input: { cwd?: string } = {}): WorkspaceTab {
  return {
    tabId: "launcher",
    target: input.cwd ? { kind: "new_tab", cwd: input.cwd } : { kind: "new_tab" },
    createdAt: 1,
  };
}

function paneNode(id: string, tabs: WorkspaceTab[]): SplitNode {
  return {
    kind: "pane",
    pane: {
      id,
      tabIds: tabs.map((tab) => tab.tabId),
      focusedTabId: tabs[0]?.tabId ?? null,
      tabs,
    },
  } as unknown as SplitNode;
}

function rowLayout(input: {
  panes: SplitNode[];
  focusedPaneId: string;
  sizes?: number[];
}): WorkspaceLayout {
  return {
    root: {
      kind: "group",
      group: {
        id: "row",
        direction: "horizontal",
        children: input.panes,
        sizes: input.sizes ?? input.panes.map(() => 1 / input.panes.length),
      },
    },
    focusedPaneId: input.focusedPaneId,
  };
}

function terminalSnapshot(terminalIds: string[]): WorkspaceTabSnapshot {
  return {
    ...hydratedEmptySnapshot(),
    knownTerminalIds: terminalIds,
    standaloneTerminalIds: terminalIds,
  };
}

function terminalTabIds(layout: WorkspaceLayout): string[] {
  return collectAllTabs(layout.root)
    .filter((tab) => tab.target.kind === "terminal")
    .map((tab) => tab.tabId);
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

describe("reconcileWorkspaceTabs terminal tab recovery", () => {
  // A reconnecting client can see an empty terminal list while the daemon is still restoring.
  // Pruning there loses every terminal tab for good, so the tabs wait for a list with entries.
  it("keeps terminal tabs when the terminal list comes back empty", () => {
    const layout = rowLayout({
      panes: [paneNode("main", [terminalTab("term-1"), terminalTab("term-2")])],
      focusedPaneId: "main",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      terminalSnapshot([]),
    );

    expect(terminalTabIds(reconciled.layout)).toEqual(["terminal_term-1", "terminal_term-2"]);
  });

  it("prunes a terminal tab once a non-empty list no longer names it", () => {
    const layout = rowLayout({
      panes: [paneNode("main", [terminalTab("term-gone"), terminalTab("term-1")])],
      focusedPaneId: "main",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      terminalSnapshot(["term-1"]),
    );

    expect(terminalTabIds(reconciled.layout)).toEqual(["terminal_term-1"]);
  });

  it("reopens a missing terminal in an empty pane instead of the focused pane", () => {
    const layout = rowLayout({
      panes: [
        paneNode("pane-a", [agentTab("a")]),
        paneNode("pane-b", [launcherTab()]),
        paneNode("pane-c", [agentTab("c")]),
      ],
      focusedPaneId: "pane-a",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      {
        ...terminalSnapshot(["term-1"]),
        activeAgentIds: ["a", "c"],
      },
    );

    const terminalTabId = terminalTabIds(reconciled.layout)[0];
    expect(terminalTabId).toBe("terminal_term-1");
    expect(findPaneContainingTab(reconciled.layout.root, terminalTabId!)?.id).toBe("pane-b");
    expect(reconciled.layout.focusedPaneId).toBe("pane-a");
    expect(
      collectAllTabs(reconciled.layout.root).filter((tab) => tab.tabId === "launcher"),
    ).toEqual([]);
  });

  it("fills empty panes in layout order before falling back to the focused pane", () => {
    const layout = rowLayout({
      panes: [
        paneNode("pane-a", [agentTab("a")]),
        paneNode("pane-b", [launcherTab()]),
        paneNode("pane-c", [launcherTab()]),
      ],
      focusedPaneId: "pane-a",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      {
        ...terminalSnapshot(["term-1", "term-2", "term-3"]),
        activeAgentIds: ["a"],
      },
    );

    expect(findPaneContainingTab(reconciled.layout.root, "terminal_term-1")?.id).toBe("pane-b");
    expect(findPaneContainingTab(reconciled.layout.root, "terminal_term-2")?.id).toBe("pane-c");
    expect(findPaneContainingTab(reconciled.layout.root, "terminal_term-3")?.id).toBe("pane-a");
  });

  it("keeps a launcher carrying a project in place", () => {
    const layout = rowLayout({
      panes: [
        paneNode("pane-a", [agentTab("a")]),
        paneNode("pane-b", [launcherTab({ cwd: "/repo" })]),
      ],
      focusedPaneId: "pane-a",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      { ...terminalSnapshot(["term-1"]), activeAgentIds: ["a"] },
    );

    expect(findPaneContainingTab(reconciled.layout.root, "terminal_term-1")?.id).toBe("pane-a");
    expect(collectAllTabs(reconciled.layout.root).map((tab) => tab.tabId)).toContain("launcher");
  });

  it("falls back to the focused pane when every pane holds a real tab", () => {
    const layout = rowLayout({
      panes: [paneNode("pane-a", [agentTab("a")]), paneNode("pane-b", [agentTab("b")])],
      focusedPaneId: "pane-b",
    });

    const reconciled = reconcileWorkspaceTabs(
      { layout, explorerSidebarPaneId: null },
      { ...terminalSnapshot(["term-1"]), activeAgentIds: ["a", "b"] },
    );

    expect(findPaneContainingTab(reconciled.layout.root, "terminal_term-1")?.id).toBe("pane-b");
  });
});
