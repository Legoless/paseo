import { describe, expect, it } from "vitest";
import { resolvePaneStatusBucket, resolvePaneStatusGlowBucket } from "./pane-status-glow";

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

describe("resolvePaneStatusBucket", () => {
  it("shows the active tab's state", () => {
    expect(resolvePaneStatusBucket([{ bucket: "running", active: true }])).toBe("running");
    expect(resolvePaneStatusBucket([{ bucket: "done", active: true }])).toBe("done");
    expect(resolvePaneStatusBucket([])).toBeNull();
  });

  it("lights up for an unseen tab behind the active one", () => {
    expect(
      resolvePaneStatusBucket([
        { bucket: "done", active: true },
        { bucket: "attention", active: false },
      ]),
    ).toBe("attention");
    expect(
      resolvePaneStatusBucket([
        { bucket: "running", active: true },
        { bucket: "failed", active: false },
      ]),
    ).toBe("failed");
  });

  it("ignores background tabs that are only working or already seen", () => {
    expect(
      resolvePaneStatusBucket([
        { bucket: "done", active: true },
        { bucket: "running", active: false },
        { bucket: null, active: false },
      ]),
    ).toBe("done");
  });

  it("puts what the user must act on first", () => {
    expect(
      resolvePaneStatusBucket([
        { bucket: "attention", active: true },
        { bucket: "needs_input", active: false },
        { bucket: "failed", active: false },
      ]),
    ).toBe("needs_input");
  });
});
