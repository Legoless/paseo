import { describe, expect, it } from "vitest";
import { isPaneLayoutSplit, parsePaneLayoutFile } from "@getpaseo/protocol/workspace-layouts";
import { BUILT_IN_PANE_LAYOUTS } from "./built-in";

describe("BUILT_IN_PANE_LAYOUTS", () => {
  it("are all valid layout files, so the built-ins can never drift from the format", () => {
    for (const layout of BUILT_IN_PANE_LAYOUTS) {
      expect(parsePaneLayoutFile({ name: layout.id, root: layout.root })).toEqual({
        ok: true,
        data: { name: layout.id, root: layout.root },
      });
    }
  });

  it("has unique ids", () => {
    const ids = BUILT_IN_PANE_LAYOUTS.map((layout) => layout.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("builds each grid as rows of columns", () => {
    const threeBySeven = BUILT_IN_PANE_LAYOUTS.find((layout) => layout.id === "grid-3x7");
    expect(threeBySeven?.nameParams).toEqual({ rows: 3, columns: 7 });

    const root = threeBySeven?.root;
    expect(root && isPaneLayoutSplit(root)).toBe(true);
    if (!root || !isPaneLayoutSplit(root)) return;

    expect(root.direction).toBe("column");
    expect(root.children).toHaveLength(3);
    for (const row of root.children) {
      expect(isPaneLayoutSplit(row)).toBe(true);
      if (!isPaneLayoutSplit(row)) continue;
      expect(row.direction).toBe("row");
      expect(row.children).toHaveLength(7);
    }
  });

  it("ships the requested grid sizes", () => {
    expect(
      BUILT_IN_PANE_LAYOUTS.filter((layout) => layout.id.startsWith("grid-")).map(
        (layout) => layout.id,
      ),
    ).toEqual(["grid-2x2", "grid-2x5", "grid-2x7", "grid-3x7"]);
  });
});
