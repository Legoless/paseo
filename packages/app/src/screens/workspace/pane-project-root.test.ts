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

describe("pane project root without a project", () => {
  const newTab = tab({ kind: "new_tab" });
  const file = tab({ kind: "file", path: "src/index.ts" });
  const agent = tab({ kind: "agent", agentId: "agent-a" });
  const input = {
    scope: "pane" as const,
    primaryCwd: "/primary",
    agentCwdById: new Map([["agent-a", "/project-a"]]),
    terminalCwdById: new Map<string, string>(),
  };

  it("gives a launcher-only pane no project, so it shows no branch or git actions", () => {
    expect(resolvePaneProjectRoot({ ...input, tabs: [newTab], activeTabId: newTab.tabId })).toBe(
      null,
    );
  });

  it("gives an empty pane no project", () => {
    expect(resolvePaneProjectRoot({ ...input, tabs: [], activeTabId: null })).toBe(null);
  });

  it("still inherits once the pane holds a real tab", () => {
    expect(
      resolvePaneProjectRoot({ ...input, tabs: [newTab, agent], activeTabId: newTab.tabId }),
    ).toBe("/project-a");
    expect(
      resolvePaneProjectRoot({ ...input, tabs: [newTab, file], activeTabId: file.tabId }),
    ).toBe("/primary");
  });

  it("keeps a launcher project-less under active-tab scope too", () => {
    expect(
      resolvePaneProjectRoot({
        ...input,
        scope: "tab",
        tabs: [newTab, agent],
        activeTabId: newTab.tabId,
      }),
    ).toBe(null);
  });
});

describe("a new agent has no project until one is chosen", () => {
  const draftWithoutProject = tab({ kind: "draft", draftId: "draft-new" });
  const input = {
    scope: "pane" as const,
    primaryCwd: "/primary",
    agentCwdById: new Map<string, string>(),
    terminalCwdById: new Map<string, string>(),
  };

  it("shows no project for a draft that has not picked one", () => {
    expect(
      resolvePaneProjectRoot({
        ...input,
        tabs: [draftWithoutProject],
        activeTabId: draftWithoutProject.tabId,
      }),
    ).toBe(null);
  });

  it("still inherits for a supporting tab beside it", () => {
    const file = tab({ kind: "file", path: "src/index.ts" });
    expect(
      resolvePaneProjectRoot({
        ...input,
        tabs: [draftWithoutProject, file],
        activeTabId: draftWithoutProject.tabId,
      }),
    ).toBe("/primary");
  });
});

describe("a draft carries the project chosen in the launcher", () => {
  const input = {
    scope: "pane" as const,
    primaryCwd: "/primary",
    agentCwdById: new Map<string, string>(),
    terminalCwdById: new Map<string, string>(),
  };

  it("uses the launcher's cwd before a provider pins a setup", () => {
    const draft = tab({ kind: "draft", draftId: "draft-a", cwd: "/Users/dev" });
    expect(resolvePaneProjectRoot({ ...input, tabs: [draft], activeTabId: draft.tabId })).toBe(
      "/Users/dev",
    );
  });

  it("prefers the pinned setup once the composer writes one", () => {
    const draft = tab({
      kind: "draft",
      draftId: "draft-b",
      cwd: "/Users/dev",
      setup: {
        provider: "claude",
        cwd: "/project-a",
        modeId: null,
        model: null,
        thinkingOptionId: null,
        featureValues: {},
      },
    });
    expect(resolvePaneProjectRoot({ ...input, tabs: [draft], activeTabId: draft.tabId })).toBe(
      "/project-a",
    );
  });
});
