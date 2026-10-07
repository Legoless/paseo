/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useFaviconStatus } from "./use-favicon-status";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";

const mocks = vi.hoisted(() => ({ setBadgeCount: vi.fn<(count?: number) => Promise<void>>() }));

// Metro turns image requires into asset references; Node needs the same test boundary.
vi.hoisted(() => {
  require.extensions[".png"] = (module) => {
    module.exports = { uri: "/favicon.png" };
  };
});

vi.mock("./use-aggregated-agents", () => ({ useAggregatedAgents: () => ({ agents: [] }) }));
vi.mock("@/constants/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/platform")>()),
  isNative: false,
  getIsElectron: () => true,
}));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    window: { getCurrentWindow: () => ({ setBadgeCount: mocks.setBadgeCount }) },
  }),
}));

const AGENT_IDS = ["agent-0", "agent-1", "agent-2", "agent-3", "agent-behind", "agent-tabless"];

/** One pane per agent; `agent-behind` sits behind `agent-0`'s tab and `agent-tabless` has no tab. */
function layoutWithUnreadAgents(): WorkspaceLayout {
  const agentTab = (agentId: string) => ({
    tabId: `agent_${agentId}`,
    target: { kind: "agent", agentId },
    createdAt: 1,
  });
  const panes = AGENT_IDS.slice(0, 4).map((agentId, index) => {
    const tabs = index === 0 ? [agentTab(agentId), agentTab("agent-behind")] : [agentTab(agentId)];
    return {
      id: `pane-${index}`,
      tabIds: tabs.map((entry) => entry.tabId),
      focusedTabId: tabs[0]?.tabId,
      tabs,
    };
  });
  return {
    root: {
      kind: "group",
      group: {
        id: "root",
        direction: "horizontal",
        sizes: panes.map(() => 1 / panes.length),
        children: panes.map((pane) => ({ kind: "pane", pane })),
      },
    } as unknown as WorkspaceLayout["root"],
    focusedPaneId: "pane-0",
  };
}

function unreadSession(): SessionState {
  const agents = AGENT_IDS.map(
    (id) =>
      [
        id,
        {
          id,
          workspaceId: "ws",
          status: "idle",
          pendingPermissions: [],
          requiresAttention: true,
          attentionReason: "finished",
        },
      ] as const,
  );
  return {
    workspaces: new Map([["ws", { id: "ws", terminalStatusBuckets: {} }]]),
    agents: new Map(agents),
  } as unknown as SessionState;
}

it("badges the unseen open tabs and clears while the previous write is still pending", async () => {
  mocks.setBadgeCount.mockResolvedValue(undefined);
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: { "srv:ws": layoutWithUnreadAgents() } });
  useSessionStore.setState({ sessions: {} });
  renderHook(() => useFaviconStatus());
  await act(async () => {});

  let finishBadgeWrite!: () => void;
  mocks.setBadgeCount.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishBadgeWrite = resolve;
      }),
  );
  act(() => useSessionStore.setState({ sessions: { srv: unreadSession() } }));
  act(() => useSessionStore.setState({ sessions: {} }));

  expect(mocks.setBadgeCount.mock.calls).toEqual([[undefined], [5], [undefined]]);
  await act(async () => finishBadgeWrite());
  expect(mocks.setBadgeCount.mock.calls).toEqual([[undefined], [5], [undefined]]);
});
