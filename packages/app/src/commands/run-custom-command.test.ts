import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { resolveCommandTabTarget } from "./run-custom-command";

function layoutFocusedOn(target: WorkspaceTab["target"]): WorkspaceLayout {
  return {
    root: {
      kind: "pane",
      pane: {
        id: "pane-1",
        tabIds: ["focused-tab"],
        focusedTabId: "focused-tab",
        tabs: [{ tabId: "focused-tab", target, createdAt: 1 }],
      },
    },
    focusedPaneId: "pane-1",
  } as WorkspaceLayout;
}

describe("resolveCommandTabTarget", () => {
  it("sends to the pane's agent tab", () => {
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout: undefined,
        paneTab: { tabId: "tab-1", target: { kind: "agent", agentId: "agent-1" } },
      }),
    ).toEqual({
      kind: "chat",
      tabId: "tab-1",
      draftKey: "agent:server-1:agent-1",
      agentId: "agent-1",
    });
  });

  it("types into the pane's terminal tab", () => {
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout: undefined,
        paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      }),
    ).toEqual({ kind: "terminal", tabId: "tab-1", terminalId: "term-1" });
  });

  it("uses the pane's tab even when another pane is focused", () => {
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout: layoutFocusedOn({ kind: "agent", agentId: "agent-1" }),
        paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      }),
    ).toEqual({ kind: "terminal", tabId: "tab-1", terminalId: "term-1" });
  });

  it("uses the focused tab without a pane, as a keyboard shortcut does", () => {
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout: layoutFocusedOn({ kind: "draft", draftId: "draft-1" }),
        paneTab: null,
      }),
    ).toEqual({
      kind: "chat",
      tabId: "focused-tab",
      draftKey: "draft:server-1:draft-1",
      agentId: null,
    });
  });

  it("takes no command in a browser tab", () => {
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout: layoutFocusedOn({ kind: "agent", agentId: "agent-1" }),
        paneTab: { tabId: "tab-1", target: { kind: "browser", browserId: "browser-1" } },
      }),
    ).toBeNull();
  });
});
