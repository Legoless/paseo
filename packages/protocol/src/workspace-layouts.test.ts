import { describe, expect, it } from "vitest";
import {
  findPaneLayoutStructuralError,
  isPaneLayoutSplit,
  PaneLayoutFileSchema,
  PaneLayoutNodeSchema,
  parsePaneLayoutFile,
} from "./workspace-layouts.js";
import { MutableDaemonConfigSchema } from "./messages.js";

/** The worked examples from docs/pane-layouts.md, verbatim. */
const MAIN_AND_SIDE = {
  name: "Main and side",
  root: { direction: "row", children: [{ size: 7 }, { size: 3 }] },
};

const REVIEW = {
  name: "Review",
  root: {
    direction: "row",
    children: [{ size: 2 }, { size: 1, direction: "column", children: [{}, {}] }],
  },
};

const COCKPIT = {
  name: "Cockpit",
  root: {
    direction: "column",
    children: [
      { size: 2, direction: "row", children: [{ size: 3 }, { size: 2 }] },
      { size: 1, direction: "row", children: [{}, {}, {}] },
    ],
  },
};

describe("PaneLayoutFileSchema", () => {
  it("parses the documented examples unchanged", () => {
    for (const example of [MAIN_AND_SIDE, REVIEW, COCKPIT]) {
      const result = PaneLayoutFileSchema.safeParse(example);
      expect(result.success).toBe(true);
      expect(result.success && result.data).toEqual(example);
    }
  });

  it("accepts a bare leaf as the whole layout", () => {
    expect(PaneLayoutFileSchema.safeParse({ name: "Single pane", root: {} }).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(PaneLayoutFileSchema.safeParse({ root: {} }).success).toBe(false);
    expect(PaneLayoutFileSchema.safeParse({ name: "", root: {} }).success).toBe(false);
  });

  it("keeps unknown keys so a newer daemon cannot break an older client's parse", () => {
    const result = PaneLayoutFileSchema.safeParse({
      name: "Future",
      description: "added later",
      root: { size: 1, tint: "blue" },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toMatchObject({
      description: "added later",
      root: { tint: "blue" },
    });
  });
});

describe("PaneLayoutNodeSchema", () => {
  it("accepts three split levels", () => {
    const threeDeep = {
      direction: "row",
      children: [
        {},
        {
          direction: "column",
          children: [{}, { direction: "row", children: [{}, {}] }],
        },
      ],
    };
    expect(PaneLayoutNodeSchema.safeParse(threeDeep).success).toBe(true);
  });

  it("rejects a non-positive size", () => {
    expect(PaneLayoutNodeSchema.safeParse({ size: 0 }).success).toBe(false);
    expect(PaneLayoutNodeSchema.safeParse({ size: -1 }).success).toBe(false);
  });
});

/**
 * The malformed-split cases all share a trap: the schema's leaf arm is `.passthrough()`, so a
 * broken split parses cleanly as a leaf and would silently collapse to one pane. parsePaneLayoutFile
 * is the gate that actually refuses them, which is why these assert through it.
 */
describe("parsePaneLayoutFile", () => {
  const wrap = (root: unknown) => ({ name: "Test", root });

  it("accepts the documented examples", () => {
    for (const example of [MAIN_AND_SIDE, REVIEW, COCKPIT]) {
      expect(parsePaneLayoutFile(example)).toEqual({ ok: true, data: example });
    }
  });

  it("rejects a fourth split level, which the app's MAX_TREE_DEPTH could not hold", () => {
    const result = parsePaneLayoutFile(
      wrap({
        direction: "row",
        children: [
          {},
          {
            direction: "column",
            children: [
              {},
              { direction: "row", children: [{}, { direction: "column", children: [{}, {}] }] },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: "root.children[1].children[1].children[1] nests deeper than 3 split levels",
    });
  });

  it("rejects a split with fewer than two or more than ten children", () => {
    expect(parsePaneLayoutFile(wrap({ direction: "row", children: [{}] }))).toEqual({
      ok: false,
      error: "root has 1 children; a split needs 2 to 10",
    });
    const eleven = Array.from({ length: 11 }, () => ({}));
    expect(parsePaneLayoutFile(wrap({ direction: "row", children: eleven }))).toEqual({
      ok: false,
      // Past ten the MIN_SPLIT_SIZE floor fills the axis and every `size` would be ignored.
      error: "root has 11 children; a split needs 2 to 10",
    });
  });

  it("accepts the widest grid the built-ins ship", () => {
    const sevenWide = { direction: "row", children: Array.from({ length: 7 }, () => ({})) };
    expect(
      parsePaneLayoutFile(
        wrap({ direction: "column", children: [sevenWide, sevenWide, sevenWide] }),
      ).ok,
    ).toBe(true);
  });

  it("rejects a misspelled direction", () => {
    expect(parsePaneLayoutFile(wrap({ directon: "row", children: [{}, {}] }))).toEqual({
      ok: false,
      error: 'root has "children" but no "direction" ("row" or "column")',
    });
  });

  it("rejects a missing name", () => {
    expect(parsePaneLayoutFile({ root: {} })).toEqual({
      ok: false,
      error: "name: Invalid input: expected string, received undefined",
    });
  });
});

describe("isPaneLayoutSplit", () => {
  it("separates splits from leaves", () => {
    const split = PaneLayoutNodeSchema.parse({ direction: "row", children: [{}, {}] });
    const leaf = PaneLayoutNodeSchema.parse({ size: 2 });
    expect(isPaneLayoutSplit(split)).toBe(true);
    expect(isPaneLayoutSplit(leaf)).toBe(false);
  });
});

describe("findPaneLayoutStructuralError", () => {
  it("passes a sound tree", () => {
    expect(findPaneLayoutStructuralError(COCKPIT.root)).toBeNull();
    expect(findPaneLayoutStructuralError({})).toBeNull();
  });

  it("catches a misspelled direction that the schema's leaf arm would swallow", () => {
    // The exact trap: this parses as a leaf, because leaves pass unknown keys through.
    const typo = { directon: "row", children: [{}, {}] };
    expect(PaneLayoutNodeSchema.safeParse(typo).success).toBe(true);
    expect(findPaneLayoutStructuralError(typo)).toBe(
      'root has "children" but no "direction" ("row" or "column")',
    );
  });

  it("names the nested node it found", () => {
    const nested = {
      direction: "row",
      children: [{}, { children: [{}, {}] }],
    };
    expect(findPaneLayoutStructuralError(nested)).toBe(
      'root.children[1] has "children" but no "direction" ("row" or "column")',
    );
  });

  it("catches children that is not an array", () => {
    expect(findPaneLayoutStructuralError({ children: {} })).toBe(
      'root has "children" that is not an array',
    );
  });
});

describe("MutableDaemonConfigSchema", () => {
  const base = {
    mcp: { injectIntoAgents: true },
    cors: { allowedOrigins: [] },
  };

  it("round-trips pane layouts and their errors", () => {
    const result = MutableDaemonConfigSchema.safeParse({
      ...base,
      paneLayouts: [{ ...REVIEW, id: "review" }],
      paneLayoutErrors: ["broken.json: root: Invalid input"],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.paneLayouts).toEqual([{ ...REVIEW, id: "review" }]);
    expect(result.success && result.data.paneLayoutErrors).toEqual([
      "broken.json: root: Invalid input",
    ]);
  });

  it("leaves both fields undefined when a daemon does not send them", () => {
    const result = MutableDaemonConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.success && result.data.paneLayouts).toBeUndefined();
    expect(result.success && result.data.paneLayoutErrors).toBeUndefined();
  });
});
