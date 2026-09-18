import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";

export interface FocusedTerminalTarget {
  tabId: string;
  terminalId: string;
}

function resolveTerminalTab(
  tab: ReturnType<typeof collectAllTabs>[number] | undefined,
): FocusedTerminalTarget | null {
  if (tab?.target.kind === "terminal") {
    return { tabId: tab.tabId, terminalId: tab.target.terminalId };
  }
  return null;
}

/**
 * The terminal a custom command should type into: the focused pane's tab when it is a
 * terminal, then any visible terminal — only a pane's focused tab is on screen. Sibling of
 * focused-chat-target.ts; unlike chats, terminals have no parent-tab fallback because a
 * subagent's parent is always an agent tab.
 */
export function resolveFocusedTerminalTarget(input: {
  layout: WorkspaceLayout | undefined;
}): FocusedTerminalTarget | null {
  if (!input.layout) {
    return null;
  }
  const tabs = collectAllTabs(input.layout.root);
  const focusedTabId = findPaneById(input.layout.root, input.layout.focusedPaneId)?.focusedTabId;
  if (focusedTabId) {
    const focusedTerminal = resolveTerminalTab(
      tabs.find((candidate) => candidate.tabId === focusedTabId),
    );
    if (focusedTerminal) {
      return focusedTerminal;
    }
  }

  for (const pane of collectAllPanes(input.layout.root)) {
    const paneTerminal = resolveTerminalTab(
      tabs.find((candidate) => candidate.tabId === pane.focusedTabId),
    );
    if (paneTerminal) {
      return paneTerminal;
    }
  }
  return null;
}
