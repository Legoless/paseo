import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { resolveCommandTabTarget, runCustomCommand } from "./run-custom-command";

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
      draftId: "draft-1",
      cwd: undefined,
      setup: undefined,
    });
  });

  it("uses the pane the screen still shows when no pane is focused", () => {
    const layout = {
      ...layoutFocusedOn({ kind: "terminal", terminalId: "term-1" }),
      focusedPaneId: null,
    };
    expect(
      resolveCommandTabTarget({
        serverId: "server-1",
        layout,
        restorePaneId: "pane-1",
        paneTab: null,
      }),
    ).toEqual({ kind: "terminal", tabId: "focused-tab", terminalId: "term-1" });
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

describe("runCustomCommand", () => {
  it("submits immediately to active agent tab", async () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { sendAgentMessage } as unknown as DaemonClient;
    const onError = vi.fn();

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "Hello agent", submit: true, target: "agent" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "agent", agentId: "agent-1" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-1",
      "Hello agent",
      expect.objectContaining({
        images: [],
        attachments: [],
      }),
    );
  });

  it("replaces draft text when submit is false on agent tab", async () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { sendAgentMessage } as unknown as DaemonClient;
    const onError = vi.fn();

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "Draft text", submit: false, target: "agent" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "agent", agentId: "agent-1" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(useDraftStore.getState().getDraftInput("agent:server-1:agent-1")?.text).toBe(
      "Draft text",
    );
  });

  it("enqueues submission on draft tab when submit is true", async () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { sendAgentMessage } as unknown as DaemonClient;
    const onError = vi.fn();
    useDraftStore.getState().saveDraftInput({
      draftKey: "draft:server-1:draft-1",
      draft: { text: "existing draft", attachments: [] },
    });

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "Draft prompt", submit: true, target: "agent" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "draft", draftId: "draft-1", cwd: "/test" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(useDraftStore.getState().getDraftInput("draft:server-1:draft-1")).toBeUndefined();
    expect(useWorkspaceDraftSubmissionStore.getState().pendingByDraftId["draft-1"]).toEqual(
      expect.objectContaining({
        serverId: "server-1",
        workspaceId: "workspace-1",
        draftId: "draft-1",
        text: "Draft prompt",
        cwd: "/test",
      }),
    );
  });

  it("replaces draft text on draft tab when submit is false", async () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { sendAgentMessage } as unknown as DaemonClient;
    const onError = vi.fn();

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "Draft prompt", submit: false, target: "agent" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "draft", draftId: "draft-2" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(useDraftStore.getState().getDraftInput("draft:server-1:draft-2")?.text).toBe(
      "Draft prompt",
    );
    expect(useWorkspaceDraftSubmissionStore.getState().pendingByDraftId["draft-2"]).toBeUndefined();
  });

  it("sends input to terminal with carriage return when submit is true", async () => {
    const sendTerminalInput = vi.fn();
    const fakeClient = { sendTerminalInput } as unknown as DaemonClient;
    const onError = vi.fn();

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "npm test", submit: true, target: "terminal" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", {
      type: "input",
      data: "npm test\r",
    });
  });

  it("sends input to terminal without carriage return when submit is false", async () => {
    const sendTerminalInput = vi.fn();
    const fakeClient = { sendTerminalInput } as unknown as DaemonClient;
    const onError = vi.fn();

    await runCustomCommand({
      serverId: "server-1",
      workspaceId: "workspace-1",
      command: { id: "test", title: "Test", text: "npm test", submit: false, target: "terminal" },
      client: fakeClient,
      paneTab: { tabId: "tab-1", target: { kind: "terminal", terminalId: "term-1" } },
      onError,
    });

    expect(onError).not.toHaveBeenCalled();
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", {
      type: "input",
      data: "npm test",
    });
  });
});
