// @vitest-environment jsdom

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { useWorkspaceArtifacts } from "./use-workspace-artifacts";

const runtime = vi.hoisted(() => ({
  listAgentTimelineImages: vi.fn(),
  prepareAgentTimeline: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => runtime,
    prepareAgentTimeline: runtime.prepareAgentTimeline,
  }),
}));

const SERVER_ID = "server-1";
const AT = new Date("2026-09-21T10:00:00.000Z");

const AGENT: Agent = {
  serverId: SERVER_ID,
  id: "agent-a",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: AT,
  updatedAt: AT,
  lastUserMessageAt: null,
  lastActivityAt: AT,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  workspaceId: "ws-1",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function seedSession(input: { imagesFeature: boolean }): void {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER_ID, null as unknown as DaemonClient);
  store.updateSessionServerInfo(SERVER_ID, {
    serverId: SERVER_ID,
    hostname: null,
    version: null,
    features: { agentTimelineImages: input.imagesFeature },
  });
  store.setAgents(SERVER_ID, new Map([[AGENT.id, AGENT]]));
}

function setTail(items: StreamItem[]): void {
  useSessionStore.getState().setAgentStreamTail(SERVER_ID, new Map([[AGENT.id, items]]));
  // A loaded tail comes with its window, which is what tells history where the stream begins.
  const seqs = items.flatMap((item) => (item.timelineCursor ? [item.timelineCursor.seq] : []));
  if (seqs.length > 0) {
    useSessionStore
      .getState()
      .setAgentTimelineCursor(
        SERVER_ID,
        new Map([
          [AGENT.id, { epoch: "e1", startSeq: Math.min(...seqs), endSeq: Math.max(...seqs) }],
        ]),
      );
  }
}

function imageMessage(id: string, seq: number, source: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    timelineCursor: { epoch: "e1", seq },
    text: `![Shot](${source})`,
    timestamp: AT,
  };
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useWorkspaceArtifacts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.listAgentTimelineImages.mockReset();
  });

  afterEach(() => {
    useSessionStore.getState().clearSession(SERVER_ID);
    vi.useRealTimers();
  });

  it("merges the daemon's full image list and refreshes it when a new image arrives", async () => {
    seedSession({ imagesFeature: true });
    setTail([imageMessage("live", 50, "/tmp/live.png")]);
    runtime.listAgentTimelineImages.mockResolvedValue({
      epoch: "e1",
      images: [
        {
          seq: 2,
          messageId: "old",
          timestamp: "2026-09-21T09:00:00.000Z",
          imageIndex: 0,
          source: "/tmp/old.png",
          alt: null,
        },
        {
          seq: 50,
          messageId: null,
          timestamp: AT.toISOString(),
          imageIndex: 0,
          source: "/tmp/live.png",
          alt: "Shot",
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspaceArtifacts({ serverId: SERVER_ID, workspaceId: "ws-1", active: true }),
    );
    await flush();

    expect(runtime.listAgentTimelineImages).toHaveBeenCalledTimes(1);
    expect(result.current.map((entry) => entry.source)).toEqual(["/tmp/old.png", "/tmp/live.png"]);

    // Text-only output cannot add an image, so it does not cost a daemon request.
    act(() =>
      setTail([
        imageMessage("live", 50, "/tmp/live.png"),
        { kind: "assistant_message", id: "text", text: "Done.", timestamp: AT },
      ]),
    );
    await flush(1000);
    expect(runtime.listAgentTimelineImages).toHaveBeenCalledTimes(1);

    act(() => setTail([imageMessage("newer", 60, "/tmp/newer.png")]));
    await flush(1000);
    expect(runtime.listAgentTimelineImages).toHaveBeenCalledTimes(2);
  });

  it("keeps the loaded-stream list on a host without the image list", async () => {
    seedSession({ imagesFeature: false });
    setTail([imageMessage("live", 50, "/tmp/live.png")]);

    const { result } = renderHook(() =>
      useWorkspaceArtifacts({ serverId: SERVER_ID, workspaceId: "ws-1", active: true }),
    );
    await flush(1000);

    expect(runtime.listAgentTimelineImages).not.toHaveBeenCalled();
    expect(result.current.map((entry) => entry.source)).toEqual(["/tmp/live.png"]);
  });
});
