/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useAgentAttentionClear } from "./use-agent-attention-clear";

vi.mock("@/utils/app-visibility", () => ({ getIsAppActivelyVisible: () => true }));

type Reason = "finished" | "error" | "permission" | null;

function renderFocusedAgent(client: DaemonClient) {
  return renderHook(
    ({
      requiresAttention,
      attentionReason,
    }: {
      requiresAttention: boolean;
      attentionReason: Reason;
    }) =>
      useAgentAttentionClear({
        agentId: "agent-1",
        client,
        isConnected: true,
        requiresAttention,
        attentionReason,
        isScreenFocused: true,
      }),
    { initialProps: { requiresAttention: false, attentionReason: null as Reason } },
  );
}

describe("useAgentAttentionClear", () => {
  it("clears a finish that landed in the focused pane once the user clicks in it", () => {
    const clearAgentAttention = vi.fn().mockResolvedValue(undefined);
    const client = { clearAgentAttention } as unknown as DaemonClient;
    const { result, rerender } = renderFocusedAgent(client);

    // The turn finishes while the pane is already focused: no focus entry follows, so nothing
    // clears it and the pane stays green.
    rerender({ requiresAttention: true, attentionReason: "finished" });
    expect(clearAgentAttention).not.toHaveBeenCalled();

    act(() => result.current.clearOnPanePress());
    expect(clearAgentAttention).toHaveBeenCalledWith("agent-1");
  });

  it("leaves a pending permission for the user to answer", () => {
    const clearAgentAttention = vi.fn().mockResolvedValue(undefined);
    const client = { clearAgentAttention } as unknown as DaemonClient;
    const { result, rerender } = renderFocusedAgent(client);

    rerender({ requiresAttention: true, attentionReason: "permission" });
    act(() => result.current.clearOnPanePress());
    expect(clearAgentAttention).not.toHaveBeenCalled();
  });
});
