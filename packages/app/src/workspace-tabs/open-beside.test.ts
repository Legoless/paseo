import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import { DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES } from "@/hooks/use-settings/storage";
import {
  DEFAULT_PANE_ID,
  findPaneContainingTab,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openPreferredWorkspacePreview } from "./open-beside";

describe("openPreferredWorkspacePreview", () => {
  it("brings an existing Explorer file to the pane whose sidebar opened it", () => {
    const workspaceKey = buildWorkspaceTabPersistenceKey({
      serverId: "server-explorer-preview",
      workspaceId: "ws-explorer-preview",
    });
    if (!workspaceKey) {
      throw new Error("expected workspace key");
    }
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey,
      target: { kind: "agent", agentId: "agent-1" },
      intent: "reveal",
    });
    const sidePaneId = store.ensureSidePane(workspaceKey);
    if (!sidePaneId) {
      throw new Error("expected side pane");
    }
    const fileTabId = store.openTab({
      workspaceKey,
      target: { kind: "file", path: "/repo/shot.png" },
      intent: "reveal",
      placement: { mode: "pane", paneId: sidePaneId },
    });
    if (!fileTabId) {
      throw new Error("expected file tab");
    }
    expect(
      findPaneContainingTab(
        useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey].root,
        fileTabId,
      )?.id,
    ).toBe(sidePaneId);

    const opened = openPreferredWorkspacePreview({
      isCompact: false,
      workspaceKey,
      serverId: "server-explorer-preview",
      workspaceId: "ws-explorer-preview",
      explorerSidebarPaneId: "explorer",
      lastMainPaneId: DEFAULT_PANE_ID,
      target: { kind: "file", path: "/repo/shot.png" },
      source: "explorerFiles",
      preferences: DEFAULT_OPEN_IN_SIDE_PANE_PREFERENCES,
    });

    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    expect(opened).toBe(fileTabId);
    expect(findPaneContainingTab(layout.root, fileTabId)?.id).toBe(DEFAULT_PANE_ID);
    expect(layout.focusedPaneId).toBe(DEFAULT_PANE_ID);
  });
});
