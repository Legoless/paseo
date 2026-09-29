import { describe, expect, it } from "vitest";
import {
  deriveDockBadgeCountFromAgents,
  isAgentActionableForDesktopBadge,
} from "./desktop-badge-state";

describe("desktop-badge-state", () => {
  it("counts agents waiting on a permission, an unseen error or an unseen finish", () => {
    expect(isAgentActionableForDesktopBadge({ status: "idle", pendingPermissionCount: 2 })).toBe(
      true,
    );
    expect(
      isAgentActionableForDesktopBadge({
        status: "error",
        requiresAttention: true,
        attentionReason: "error",
      }),
    ).toBe(true);
    expect(
      isAgentActionableForDesktopBadge({
        status: "idle",
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe(true);
  });

  it("ignores agents that are seen, idle or still working", () => {
    expect(isAgentActionableForDesktopBadge({ status: "idle" })).toBe(false);
    expect(isAgentActionableForDesktopBadge({ status: "error", requiresAttention: false })).toBe(
      false,
    );
    expect(
      isAgentActionableForDesktopBadge({
        status: "running",
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe(false);
    expect(
      isAgentActionableForDesktopBadge({
        status: "idle",
        backgroundWorkCount: 1,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe(false);
  });

  it("returns undefined when no agent needs attention", () => {
    expect(
      deriveDockBadgeCountFromAgents([
        { status: "idle" },
        { status: "error", requiresAttention: false },
      ]),
    ).toBeUndefined();
  });

  it("counts each actionable agent once", () => {
    expect(
      deriveDockBadgeCountFromAgents([
        { status: "idle" },
        { status: "idle", requiresAttention: true, attentionReason: "finished" },
        { status: "idle", pendingPermissionCount: 1 },
        {
          status: "error",
          requiresAttention: true,
          attentionReason: "error",
          pendingPermissionCount: 3,
        },
      ]),
    ).toBe(3);
  });
});
