import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ListTerminalsResponse } from "@getpaseo/protocol/messages";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { type Agent, type SessionState, useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  useWorkspaceTabRename,
  WorkspaceTabRenameModal,
} from "@/screens/workspace/use-workspace-tab-rename";

const { theme, adaptiveInputState } = vi.hoisted(() => ({
  adaptiveInputState: {
    latestProps: null as {
      onChangeText?: (next: string) => void;
      onSubmitEditing?: () => void;
    } | null,
  },
  theme: {
    spacing: { 2: 8, 3: 12 },
    fontSize: { sm: 13, base: 15 },
    borderRadius: { md: 6 },
    colors: {
      surface0: "#000",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      border: "#555",
      palette: { red: { 300: "#f87171" } },
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    title,
    children,
    onClose,
    testID,
  }: {
    visible: boolean;
    title: string;
    children: React.ReactNode;
    onClose: () => void;
    testID?: string;
  }) => {
    if (!visible) return null;
    return ReactModule.createElement(
      "div",
      { "data-testid": testID ?? "adaptive-modal-sheet", "data-modal-title": title },
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": "adaptive-modal-sheet-close",
          onClick: onClose,
        },
        "Close",
      ),
      children,
    );
  };
  const AdaptiveTextInput = ReactModule.forwardRef<HTMLInputElement, Record<string, unknown>>(
    (props, ref) => {
      const p = props as {
        initialValue?: string;
        defaultValue?: string;
        editable?: boolean;
        maxLength?: number;
        testID?: string;
        onChangeText?: (next: string) => void;
        onSubmitEditing?: () => void;
      };
      adaptiveInputState.latestProps = {
        onChangeText: p.onChangeText,
        onSubmitEditing: p.onSubmitEditing,
      };
      return ReactModule.createElement("input", {
        ref,
        defaultValue: p.initialValue ?? p.defaultValue ?? "",
        disabled: p.editable === false,
        maxLength: p.maxLength,
        "data-testid": p.testID,
        onChange: (e: { target: { value: string } }) => p.onChangeText?.(e.target.value),
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "Enter") {
            e.preventDefault();
            p.onSubmitEditing?.();
          }
        },
      });
    },
  );
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      onPress,
      disabled,
      testID,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          type: "button",
          "data-testid": testID,
          disabled: disabled || undefined,
          onClick: () => !disabled && onPress?.(),
        },
        children,
      ),
  };
});

describe("useWorkspaceTabRename with comma and punctuation titles", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let queryClient: QueryClient;
  const serverId = "srv_test";
  const persistenceKey = "srv_test:wks_test";

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost",
    });
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("HTMLInputElement", dom.window.HTMLInputElement);
    vi.stubGlobal("KeyboardEvent", dom.window.KeyboardEvent);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("navigator", dom.window.navigator);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    adaptiveInputState.latestProps = null;

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    useWorkspaceLayoutStore.setState((state) => ({
      ...state,
      layoutByWorkspace: {
        [persistenceKey]: {
          root: {
            kind: "pane",
            pane: {
              id: "main-pane",
              tabIds: ["tab-agent-1", "tab-terminal-1", "tab-files-1"],
              focusedTabId: "tab-agent-1",
              tabs: [
                {
                  tabId: "tab-agent-1",
                  target: { kind: "agent", agentId: "agent-1" },
                  createdAt: 1000,
                },
                {
                  tabId: "tab-terminal-1",
                  target: { kind: "terminal", terminalId: "term-1" },
                  createdAt: 2000,
                },
                {
                  tabId: "tab-files-1",
                  target: { kind: "files" },
                  createdAt: 3000,
                },
              ],
            },
          },
          focusedPaneId: "main-pane",
        },
      },
    }));

    useSessionStore.setState((state) => ({
      ...state,
      sessions: {
        [serverId]: {
          serverId,
          agents: new Map([
            [
              "agent-1",
              {
                id: "agent-1",
                title: "Original Agent",
                provider: "codex",
                status: "idle",
                pendingPermissions: [],
                requiresAttention: false,
                attentionReason: null,
                labels: {},
              } as unknown as Agent,
            ],
          ]),
          agentDetails: new Map(),
          client: null as unknown as DaemonClient,
        } as unknown as SessionState,
      },
    }));
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  function renderHookHarness(options: {
    client: DaemonClient | null;
    terminalsData?: ListTerminalsResponse["payload"];
  }) {
    let hookResult!: ReturnType<typeof useWorkspaceTabRename>;

    function TestHarness() {
      hookResult = useWorkspaceTabRename({
        client: options.client,
        normalizedServerId: serverId,
        queryClient,
        terminalsData: options.terminalsData,
        terminalsQueryKey: ["terminals", serverId],
        persistenceKey,
      });

      return (
        <WorkspaceTabRenameModal
          renamingTab={hookResult.renamingTab}
          onClose={hookResult.handleRenameModalClose}
          onSubmit={hookResult.handleRenameModalSubmit}
        />
      );
    }

    act(() => {
      root!.render(<TestHarness />);
    });

    return {
      get result() {
        return hookResult;
      },
    };
  }

  it("renames an agent tab with titles containing commas and punctuation", async () => {
    const updateAgentMock = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      updateAgent: updateAgentMock,
    } as unknown as DaemonClient;

    const harness = renderHookHarness({ client: mockClient });

    const agentTab: WorkspaceTabDescriptor = {
      key: "tab-agent-1",
      tabId: "tab-agent-1",
      kind: "agent",
      target: { kind: "agent", agentId: "agent-1" },
      title: "Original Agent",
    };

    act(() => {
      harness.result.handleRenameTab(agentTab, "Original Agent");
    });

    expect(harness.result.renamingTab).toEqual({
      kind: "agent",
      id: "agent-1",
      tabId: "tab-agent-1",
      currentTitle: "Original Agent",
    });

    const complexTitleWithComma = "fix(auth), refactor(session): handle 401, 403 & errors";
    await act(async () => {
      await harness.result.handleRenameModalSubmit(complexTitleWithComma);
    });

    expect(updateAgentMock).toHaveBeenCalledWith("agent-1", {
      name: complexTitleWithComma,
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(persistenceKey);
    const updatedTab = tabs.find((t) => t.tabId === "tab-agent-1");
    expect(updatedTab?.title).toBe(complexTitleWithComma);
  });

  it("renames a terminal tab with titles containing commas and whitespace", async () => {
    const renameTerminalMock = vi.fn().mockResolvedValue({ success: true, error: null });
    const mockClient = {
      renameTerminal: renameTerminalMock,
    } as unknown as DaemonClient;

    const terminalsData: ListTerminalsResponse["payload"] = {
      requestId: "req-terminals",
      terminals: [
        {
          id: "term-1",
          name: "zsh",
          title: "Initial Term",
          cwd: "/workspace",
          activity: {
            state: "idle",
            changedAt: 0,
          },
        },
      ],
    };

    const harness = renderHookHarness({ client: mockClient, terminalsData });

    const terminalTab: WorkspaceTabDescriptor = {
      key: "tab-terminal-1",
      tabId: "tab-terminal-1",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "term-1" },
      title: "Initial Term",
    };

    act(() => {
      harness.result.handleRenameTab(terminalTab, "Initial Term");
    });

    expect(harness.result.renamingTab).toEqual({
      kind: "terminal",
      id: "term-1",
      tabId: "tab-terminal-1",
      currentTitle: "Initial Term",
    });

    const titleWithComma = "  build, test, lint  ";
    await act(async () => {
      await harness.result.handleRenameModalSubmit(titleWithComma);
    });

    expect(renameTerminalMock).toHaveBeenCalledWith({
      terminalId: "term-1",
      title: "build, test, lint",
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(persistenceKey);
    const updatedTab = tabs.find((t) => t.tabId === "tab-terminal-1");
    expect(updatedTab?.title).toBe("build, test, lint");
  });

  it("renames a general workspace tab (files/changes) with commas directly in layout store", async () => {
    const harness = renderHookHarness({ client: null });

    const filesTab: WorkspaceTabDescriptor = {
      key: "tab-files-1",
      tabId: "tab-files-1",
      kind: "files",
      target: { kind: "files" },
    };

    act(() => {
      harness.result.handleRenameTab(filesTab, "Files");
    });

    expect(harness.result.renamingTab).toEqual({
      kind: "tab",
      id: "tab-files-1",
      tabId: "tab-files-1",
      currentTitle: "Files",
    });

    const titleWithMultipleCommas = "config, src, tests, docs";
    await act(async () => {
      await harness.result.handleRenameModalSubmit(titleWithMultipleCommas);
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(persistenceKey);
    const updatedTab = tabs.find((t) => t.tabId === "tab-files-1");
    expect(updatedTab?.title).toBe(titleWithMultipleCommas);
  });

  it("clears a renamed tab title when empty or whitespace string is submitted", async () => {
    const harness = renderHookHarness({ client: null });

    const filesTab: WorkspaceTabDescriptor = {
      key: "tab-files-1",
      tabId: "tab-files-1",
      kind: "files",
      target: { kind: "files" },
      title: "Previous Title",
    };

    act(() => {
      harness.result.handleRenameTab(filesTab, "Previous Title");
    });

    await act(async () => {
      await harness.result.handleRenameModalSubmit("    ");
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(persistenceKey);
    const updatedTab = tabs.find((t) => t.tabId === "tab-files-1");
    expect(updatedTab?.title).toBeUndefined();
  });

  it("handles modal text change and submission with commas via UI interaction", async () => {
    const updateAgentMock = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      updateAgent: updateAgentMock,
    } as unknown as DaemonClient;

    const harness = renderHookHarness({ client: mockClient });

    const agentTab: WorkspaceTabDescriptor = {
      key: "tab-agent-1",
      tabId: "tab-agent-1",
      kind: "agent",
      target: { kind: "agent", agentId: "agent-1" },
    };

    act(() => {
      harness.result.handleRenameTab(agentTab, "Agent 1");
    });

    expect(
      container?.querySelector("[data-testid='workspace-tab-rename-modal-agent-agent-1']"),
    ).toBeTruthy();

    act(() => {
      adaptiveInputState.latestProps?.onChangeText?.("component, test, fix");
    });

    await act(async () => {
      adaptiveInputState.latestProps?.onSubmitEditing?.();
    });

    expect(updateAgentMock).toHaveBeenCalledWith("agent-1", {
      name: "component, test, fix",
    });

    const tabs = useWorkspaceLayoutStore.getState().getWorkspaceTabs(persistenceKey);
    expect(tabs.find((t) => t.tabId === "tab-agent-1")?.title).toBe("component, test, fix");
  });
});
