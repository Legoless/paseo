import { describe, expect, it } from "vitest";
import { snapResizeDelta, SPLIT_RESIZE_SNAP_PX } from "@/components/resize-handle-snap";

describe("snapResizeDelta", () => {
  it("snaps to a parallel divider inside the threshold", () => {
    expect(snapResizeDelta(38, [40, -120])).toBe(40);
  });

  it("keeps the raw distance outside the threshold", () => {
    expect(snapResizeDelta(30, [40, -120])).toBe(30);
  });

  it("picks the closest divider when several are in range", () => {
    expect(snapResizeDelta(40, [37, 42, 44])).toBe(42);
  });

  it("snaps at exactly the threshold", () => {
    expect(snapResizeDelta(0, [SPLIT_RESIZE_SNAP_PX])).toBe(SPLIT_RESIZE_SNAP_PX);
    expect(snapResizeDelta(0, [SPLIT_RESIZE_SNAP_PX + 0.01])).toBe(0);
  });

  it("passes the distance through when there is nothing to snap to", () => {
    expect(snapResizeDelta(12.5, [])).toBe(12.5);
  });
});
