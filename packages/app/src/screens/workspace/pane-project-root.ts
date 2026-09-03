import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function targetCwd(
  tab: WorkspaceTabDescriptor,
  agentCwdById: ReadonlyMap<string, string>,
  terminalCwdById: ReadonlyMap<string, string>,
): string | null {
  const { target } = tab;
  if (target.kind === "draft") return target.setup?.cwd ?? target.cwd ?? null;
  if (target.kind === "agent") return agentCwdById.get(target.agentId) ?? null;
  if (target.kind === "provider_subagent") {
    return agentCwdById.get(target.parentAgentId) ?? null;
  }
  if (target.kind === "terminal") return terminalCwdById.get(target.terminalId) ?? null;
  if (target.kind === "plugin" && target.context === "agent") {
    return agentCwdById.get(target.agentId) ?? null;
  }
  return null;
}

/**
 * Tabs whose project is a property of the tab itself, so an unset one means "not chosen yet"
 * rather than "inherit the workspace's".
 */
function ownsItsProject(tab: WorkspaceTabDescriptor): boolean {
  const { kind } = tab.target;
  return (
    kind === "new_tab" ||
    kind === "draft" ||
    kind === "agent" ||
    kind === "terminal" ||
    kind === "provider_subagent"
  );
}

/** Resolves the project owned by the active tab, with optional pane-group inheritance. */
export function resolvePaneProjectRoot(input: {
  tabs: WorkspaceTabDescriptor[];
  activeTabId: string | null;
  scope: "tab" | "pane";
  primaryCwd: string | null;
  agentCwdById: ReadonlyMap<string, string>;
  terminalCwdById: ReadonlyMap<string, string>;
}): string | null {
  const active = input.tabs.find((tab) => tab.tabId === input.activeTabId) ?? null;
  let candidates = active ? [active] : [];
  if (input.scope === "pane") {
    candidates = active ? [active, ...input.tabs.filter((tab) => tab !== active)] : input.tabs;
  }
  for (const tab of candidates) {
    const cwd = targetCwd(tab, input.agentCwdById, input.terminalCwdById)?.trim();
    if (cwd) return cwd;
  }
  // Nothing above resolved a cwd. Tabs that carry their own project have therefore not chosen one
  // yet — a launcher, or a new agent whose project is still unset — and a pane holding only those
  // has no project rather than the workspace's. Borrowing it would put a branch badge and git
  // actions on an empty pane, and every empty pane in a grid would claim the same branch.
  // Supporting tabs like a file or a diff still inherit: those are a project being looked at.
  if (candidates.every(ownsItsProject)) {
    return null;
  }
  return input.primaryCwd?.trim() || null;
}
