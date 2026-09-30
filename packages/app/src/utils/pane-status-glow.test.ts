import { describe, expect, it } from "vitest";
import { resolvePaneStatusGlowBucket } from "./pane-status-glow";

describe("resolvePaneStatusGlowBucket", () => {
  it("lights the four live agent states", () => {
    expect(resolvePaneStatusGlowBucket("running")).toBe("running");
    expect(resolvePaneStatusGlowBucket("needs_input")).toBe("needs_input");
    expect(resolvePaneStatusGlowBucket("failed")).toBe("failed");
    expect(resolvePaneStatusGlowBucket("attention")).toBe("attention");
  });

  it("goes dark once finished attention is cleared", () => {
    expect(resolvePaneStatusGlowBucket("done")).toBeNull();
  });

  it("stays off without a status", () => {
    expect(resolvePaneStatusGlowBucket(null)).toBeNull();
  });
});
