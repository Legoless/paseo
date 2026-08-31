import { describe, expect, it } from "vitest";
import { resolvePaneProjectRoot } from "@/screens/workspace/pane-project-root";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function tab(target: WorkspaceTabDescriptor["target"]): WorkspaceTabDescriptor {
  const tabId = JSON.stringify(target);
  return { key: tabId, tabId, kind: target.kind, target };
}

describe("pane project root", () => {
  const agent = tab({ kind: "agent", agentId: "agent-a" });
  const terminal = tab({ kind: "terminal", terminalId: "terminal-b" });
  const file = tab({ kind: "file", path: "src/index.ts" });
  const input = {
    scope: "pane" as const,
    primaryCwd: "/primary",
    agentCwdById: new Map([["agent-a", "/project-a"]]),
    terminalCwdById: new Map([["terminal-b", "/project-b"]]),
  };

  it("follows the active agent or terminal", () => {
    expect(
      resolvePaneProjectRoot({ ...input, tabs: [agent, terminal], activeTabId: terminal.tabId }),
    ).toBe("/project-b");
  });

  it("lets a supporting tab inherit the pane's project", () => {
    expect(resolvePaneProjectRoot({ ...input, tabs: [file, agent], activeTabId: file.tabId })).toBe(
      "/project-a",
    );
  });

  it("keeps active-tab scope out of sibling tab projects", () => {
    expect(
      resolvePaneProjectRoot({
        ...input,
        scope: "tab",
        tabs: [file, agent],
        activeTabId: file.tabId,
      }),
    ).toBe("/primary");
  });

  it("uses a draft's selected project and otherwise falls back to the primary project", () => {
    const draft = tab({
      kind: "draft",
      draftId: "draft-a",
      setup: {
        provider: "codex",
        cwd: "/draft-project",
        modeId: null,
        model: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    expect(resolvePaneProjectRoot({ ...input, tabs: [draft], activeTabId: draft.tabId })).toBe(
      "/draft-project",
    );
    expect(resolvePaneProjectRoot({ ...input, tabs: [file], activeTabId: file.tabId })).toBe(
      "/primary",
    );
  });
});
