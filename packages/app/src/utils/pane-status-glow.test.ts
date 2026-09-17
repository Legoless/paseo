import { describe, expect, it } from "vitest";
import { resolvePaneStatusGlowBucket } from "./pane-status-glow";

describe("resolvePaneStatusGlowBucket", () => {
  it("lights the four live agent states", () => {
    expect(resolvePaneStatusGlowBucket({ bucket: "running" })).toBe("running");
    expect(resolvePaneStatusGlowBucket({ bucket: "needs_input" })).toBe("needs_input");
    expect(resolvePaneStatusGlowBucket({ bucket: "failed" })).toBe("failed");
    expect(resolvePaneStatusGlowBucket({ bucket: "attention" })).toBe("attention");
  });

  it("keeps green on a started idle agent after finished attention clears", () => {
    expect(resolvePaneStatusGlowBucket({ bucket: "done", hasStarted: true })).toBe("attention");
  });

  it("stays off when the agent was never started", () => {
    expect(resolvePaneStatusGlowBucket({ bucket: "done" })).toBeNull();
    expect(resolvePaneStatusGlowBucket({ bucket: "done", hasStarted: false })).toBeNull();
    expect(resolvePaneStatusGlowBucket({ bucket: null, hasStarted: true })).toBeNull();
    expect(resolvePaneStatusGlowBucket({ bucket: null })).toBeNull();
  });
});
