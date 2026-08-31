import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function targetCwd(
  tab: WorkspaceTabDescriptor,
  agentCwdById: ReadonlyMap<string, string>,
  terminalCwdById: ReadonlyMap<string, string>,
): string | null {
  const { target } = tab;
  if (target.kind === "draft") return target.setup?.cwd ?? null;
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
  return input.primaryCwd?.trim() || null;
}
