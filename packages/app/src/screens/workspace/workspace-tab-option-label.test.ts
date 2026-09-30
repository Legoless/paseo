import { describe, expect, it } from "vitest";
import {
  getFallbackTabOptionLabel,
  type WorkspaceTabOptionLabels,
} from "@/screens/workspace/workspace-tab-option-label";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

const labels: WorkspaceTabOptionLabels = {
  newTab: "New tab",
  newAgent: "New agent",
  setup: "Setup",
  terminal: "Terminal",
  browser: "Browser",
  agent: "Agent",
  changes: "Changes",
  files: "Files",
  artifacts: "Artifacts",
  pullRequest: "Pull request",
};

function draftTab(title?: string): WorkspaceTabDescriptor {
  return {
    key: "draft_1",
    tabId: "draft_1",
    kind: "draft",
    target: { kind: "draft", draftId: "draft-1" },
    title,
  };
}

function terminalTab(title?: string): WorkspaceTabDescriptor {
  return {
    key: "terminal_1",
    tabId: "terminal_1",
    kind: "terminal",
    target: { kind: "terminal", terminalId: "terminal-1" },
    title,
  };
}

describe("getFallbackTabOptionLabel", () => {
  it("shows the name the user gave a draft tab", () => {
    expect(getFallbackTabOptionLabel(draftTab("Refactor auth"), labels)).toBe("Refactor auth");
  });

  it("falls back to the kind label for an unnamed draft tab", () => {
    expect(getFallbackTabOptionLabel(draftTab(), labels)).toBe("New agent");
  });

  it("shows the name the user gave a terminal tab", () => {
    expect(getFallbackTabOptionLabel(terminalTab("dev server"), labels)).toBe("dev server");
  });

  it("ignores a whitespace-only title", () => {
    expect(getFallbackTabOptionLabel(terminalTab("   "), labels)).toBe("Terminal");
  });
});
