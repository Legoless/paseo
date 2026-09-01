import { describe, expect, it } from "vitest";
import { resolveGroupSizes } from "./split-container-group-sizes";

describe("resolveGroupSizes", () => {
  it("uses the persisted override when it still describes the group", () => {
    const storedSizes = [0.5, 0.3, 0.2];

    expect(
      resolveGroupSizes({ storedSizes, structuralSizes: [0.34, 0.33, 0.33], childCount: 3 }),
    ).toBe(storedSizes);
  });

  it("falls back to the layout sizes when the group gained a child", () => {
    // The five-pane row that could not resize its last pane: four stored entries, five children,
    // so the fifth defaulted to a whole flex unit and took half the row.
    expect(
      resolveGroupSizes({
        storedSizes: [0.25, 0.31, 0.21, 0.23],
        structuralSizes: [0.25, 0.25, 0.25, 0.125, 0.125],
        childCount: 5,
      }),
    ).toEqual([0.25, 0.25, 0.25, 0.125, 0.125]);
  });

  it("falls back to the layout sizes when the group lost a child", () => {
    expect(
      resolveGroupSizes({
        storedSizes: [0.25, 0.18, 0.18, 0.19, 0.2],
        structuralSizes: [0.167, 0.167, 0.333, 0.333],
        childCount: 4,
      }),
    ).toEqual([0.167, 0.167, 0.333, 0.333]);
  });

  it("falls back when no override has been stored yet", () => {
    expect(
      resolveGroupSizes({ storedSizes: undefined, structuralSizes: [0.6, 0.4], childCount: 2 }),
    ).toEqual([0.6, 0.4]);
  });
});
