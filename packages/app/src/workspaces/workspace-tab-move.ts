import { collectAllTabs, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { workspaceTabTargetOwnCwd } from "@/workspace-tabs/new-tab";
import { panelResourceKey } from "@/panels/panel-manifest";

export function selectAgentWorkspaceTabs(
  layout: WorkspaceLayout | undefined,
  agentIds: readonly string[],
  capturedLayout?: WorkspaceLayout,
): WorkspaceTab[] {
  const ids = new Set(agentIds);
  return selectCurrentAndCapturedEntityTabs(layout, capturedLayout, (tab) => {
    const target = tab.target;
    if (target.kind === "agent") return ids.has(target.agentId);
    if (target.kind === "provider_subagent") return ids.has(target.parentAgentId);
    return target.kind === "plugin" && target.context === "agent" && ids.has(target.agentId);
  });
}

function selectCurrentAndCapturedEntityTabs(
  layout: WorkspaceLayout | undefined,
  capturedLayout: WorkspaceLayout | undefined,
  matches: (tab: WorkspaceTab) => boolean,
): WorkspaceTab[] {
  const currentTabs = layout ? collectAllTabs(layout.root) : [];
  const currentIds = new Set(currentTabs.map((tab) => tab.tabId));
  const currentEntities = currentTabs.filter(matches);
  const currentResourceKeys = new Set(currentEntities.map((tab) => panelResourceKey(tab.target)));
  const capturedTabs = capturedLayout ? collectAllTabs(capturedLayout.root) : [];
  return [
    ...currentEntities,
    ...capturedTabs.filter(
      (tab) =>
        !currentIds.has(tab.tabId) &&
        matches(tab) &&
        !currentResourceKeys.has(panelResourceKey(tab.target)),
    ),
  ];
}

export function selectWorkspaceMemberTabs(input: {
  layout: WorkspaceLayout | undefined;
  capturedLayout?: WorkspaceLayout;
  cwd: string;
  agentIds: readonly string[];
  terminalIds: readonly string[];
}): WorkspaceTab[] {
  const agentTabIds = new Set(
    selectAgentWorkspaceTabs(input.layout, input.agentIds, input.capturedLayout).map(
      (tab) => tab.tabId,
    ),
  );
  const terminalIds = new Set(input.terminalIds);
  const entityTabs = selectCurrentAndCapturedEntityTabs(
    input.layout,
    input.capturedLayout,
    (tab) =>
      agentTabIds.has(tab.tabId) ||
      (tab.target.kind === "terminal" && terminalIds.has(tab.target.terminalId)),
  );
  if (!input.layout) return entityTabs;
  const entityTabIds = new Set(entityTabs.map((tab) => tab.tabId));
  const cwd = input.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const directoryTabs = collectAllTabs(input.layout.root).filter((tab) => {
    if (entityTabIds.has(tab.tabId)) return false;
    if (workspaceTabTargetOwnCwd(tab.target) === input.cwd) return true;
    if (tab.target.kind === "file") {
      const path = tab.target.path.replace(/\\/g, "/");
      return path.startsWith(`${cwd}/`);
    }
    return false;
  });
  const selectedTabIds = new Set([...entityTabs, ...directoryTabs].map((tab) => tab.tabId));
  const currentTabs = collectAllTabs(input.layout.root);
  const currentTabIds = new Set(currentTabs.map((tab) => tab.tabId));
  return [
    ...currentTabs.filter((tab) => selectedTabIds.has(tab.tabId)),
    ...entityTabs.filter((tab) => !currentTabIds.has(tab.tabId)),
  ];
}
