import { describe, expect, it } from "vitest";
import {
  deriveDockBadgeCountFromAgents,
  isAgentActionableForDesktopBadge,
} from "./desktop-badge-state";

describe("desktop-badge-state", () => {
  it("treats finished, failed and permission-blocked agents as actionable", () => {
    expect(isAgentActionableForDesktopBadge({ requiresAttention: true })).toBe(true);
    expect(isAgentActionableForDesktopBadge({ pendingPermissionCount: 2 })).toBe(true);
  });

  it("ignores agents that are working or already seen", () => {
    expect(isAgentActionableForDesktopBadge({})).toBe(false);
    expect(isAgentActionableForDesktopBadge({ requiresAttention: false })).toBe(false);
    expect(
      isAgentActionableForDesktopBadge({ requiresAttention: false, pendingPermissionCount: 0 }),
    ).toBe(false);
  });

  it("returns undefined when no agent needs attention", () => {
    expect(deriveDockBadgeCountFromAgents([{}, { requiresAttention: false }])).toBeUndefined();
  });

  it("counts each actionable agent once", () => {
    expect(
      deriveDockBadgeCountFromAgents([
        {},
        { requiresAttention: true },
        { requiresAttention: false, pendingPermissionCount: 1 },
        { requiresAttention: true, pendingPermissionCount: 3 },
      ]),
    ).toBe(3);
  });
});
