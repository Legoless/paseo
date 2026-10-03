/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AggregatedAgent } from "./use-aggregated-agents";
import { useFaviconStatus } from "./use-favicon-status";
import { TURN_LIVENESS_IDLE } from "@/timeline/turn-liveness";

const mocks = vi.hoisted(() => {
  const agents: AggregatedAgent[] = [];
  return { agents, setBadgeCount: vi.fn<(count?: number) => Promise<void>>() };
});

// Metro turns image requires into asset references; Node needs the same test boundary.
vi.hoisted(() => {
  require.extensions[".png"] = (module) => {
    module.exports = { uri: "/favicon.png" };
  };
});

vi.mock("./use-aggregated-agents", () => ({
  useAggregatedAgents: () => ({ agents: mocks.agents }),
}));
vi.mock("@/constants/platform", () => ({ isNative: false, getIsElectron: () => true }));
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    window: { getCurrentWindow: () => ({ setBadgeCount: mocks.setBadgeCount }) },
  }),
}));

it("clears attention while the previous dock badge write is still pending", async () => {
  mocks.setBadgeCount.mockResolvedValue(undefined);
  const { rerender } = renderHook(() => useFaviconStatus());
  await act(async () => {});

  let finishBadgeWrite!: () => void;
  mocks.setBadgeCount.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishBadgeWrite = resolve;
      }),
  );
  mocks.agents = Array.from(
    { length: 4 },
    (_, index): AggregatedAgent => ({
      id: `agent-${index}`,
      serverId: "server-1",
      serverLabel: "Host",
      title: null,
      status: "idle",
      turn: TURN_LIVENESS_IDLE,
      lastActivityAt: new Date(0),
      createdAt: new Date(0),
      cwd: "/repo",
      workspaceId: "workspace-1",
      provider: "codex",
      labels: {},
      requiresAttention: true,
      attentionReason: "finished",
    }),
  );
  rerender();
  mocks.agents = [];
  rerender();

  expect(mocks.setBadgeCount.mock.calls).toEqual([[undefined], [4], [undefined]]);
  await act(async () => finishBadgeWrite());
  expect(mocks.setBadgeCount.mock.calls).toEqual([[undefined], [4], [undefined]]);
});
