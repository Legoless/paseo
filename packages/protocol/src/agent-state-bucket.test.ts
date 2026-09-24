import { describe, expect, it } from "vitest";
import {
  deriveAgentStateBucket,
  getAgentStatusPriority,
  getWorkspaceStateBucketPriority,
} from "./agent-state-bucket.js";

describe("deriveAgentStateBucket", () => {
  it("prioritizes pending permissions as needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 1,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("needs_input");
  });

  it("keeps legacy permission attention in needs_input", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "permission",
      }),
    ).toBe("needs_input");
  });

  it("prioritizes error attention before running status", () => {
    expect(
      deriveAgentStateBucket({
        status: "running",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "error",
      }),
    ).toBe("failed");
  });

  it("treats unread finished agents as attention", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        pendingPermissionCount: 0,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("attention");
  });

  it("does not count initializing agents as running for workspace buckets", () => {
    expect(
      deriveAgentStateBucket({
        status: "initializing",
        pendingPermissionCount: 0,
        requiresAttention: false,
        attentionReason: null,
      }),
    ).toBe("done");
  });

  it("keeps an idle agent with live background work running, ahead of unseen finished", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        backgroundWorkCount: 1,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("running");
  });

  it("drops back when background work empties", () => {
    expect(
      deriveAgentStateBucket({
        status: "idle",
        backgroundWorkCount: 0,
        requiresAttention: true,
        attentionReason: "finished",
      }),
    ).toBe("attention");
    expect(deriveAgentStateBucket({ status: "idle", backgroundWorkCount: 0 })).toBe("done");
  });

  it("lets permissions and errors outrank background work", () => {
    expect(
      deriveAgentStateBucket({ status: "idle", pendingPermissionCount: 1, backgroundWorkCount: 2 }),
    ).toBe("needs_input");
    expect(deriveAgentStateBucket({ status: "error", backgroundWorkCount: 2 })).toBe("failed");
  });
});

describe("getWorkspaceStateBucketPriority", () => {
  it("orders active buckets before done", () => {
    expect(
      ["done", "attention", "running", "failed", "needs_input"].sort(
        (left, right) =>
          getWorkspaceStateBucketPriority(left) - getWorkspaceStateBucketPriority(right),
      ),
    ).toEqual(["needs_input", "failed", "running", "attention", "done"]);
  });
});

describe("getAgentStatusPriority", () => {
  it("keeps initializing agents ahead of completed agents in agent lists", () => {
    expect(getAgentStatusPriority({ status: "initializing" })).toBeLessThan(
      getAgentStatusPriority({ status: "idle" }),
    );
  });

  it("prioritizes pending permissions before errors and running agents", () => {
    const permission = getAgentStatusPriority({ status: "running", pendingPermissionCount: 1 });
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "error", pendingPermissionCount: 0 }),
    );
    expect(permission).toBeLessThan(
      getAgentStatusPriority({ status: "running", pendingPermissionCount: 0 }),
    );
  });
});
