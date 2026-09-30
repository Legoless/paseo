import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export interface WorkspaceTabOptionLabels {
  newTab: string;
  newAgent: string;
  setup: string;
  terminal: string;
  browser: string;
  agent: string;
  changes: string;
  files: string;
  artifacts: string;
  pullRequest: string;
}

export function getFallbackTabOptionLabel(
  tab: WorkspaceTabDescriptor,
  labels: WorkspaceTabOptionLabels,
): string {
  // A name the user typed is the master: the compact switcher and "..." menu must show the same
  // name the tab strip does.
  const title = tab.title?.trim();
  if (title) {
    return title;
  }
  if (tab.target.kind === "new_tab") {
    return labels.newTab;
  }
  if (tab.target.kind === "draft") {
    return labels.newAgent;
  }
  if (tab.target.kind === "setup") {
    return labels.setup;
  }
  if (tab.target.kind === "terminal") {
    return labels.terminal;
  }
  if (tab.target.kind === "browser") {
    return labels.browser;
  }
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  if (tab.target.kind === "working_diff" || tab.target.kind === "changes_tree") {
    return labels.changes;
  }
  if (tab.target.kind === "files") {
    return labels.files;
  }
  if (tab.target.kind === "artifacts") {
    return labels.artifacts;
  }
  if (tab.target.kind === "pull_request") {
    return labels.pullRequest;
  }
  if (tab.target.kind === "commit_diff") {
    return tab.target.sha.slice(0, 7);
  }
  return labels.agent;
}
