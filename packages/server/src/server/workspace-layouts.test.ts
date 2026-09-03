import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPaneLayouts, PANE_LAYOUTS_DIRNAME } from "./workspace-layouts.js";

describe("loadPaneLayouts", () => {
  let paseoHome: string;

  beforeEach(() => {
    paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-layouts-"));
  });

  afterEach(() => {
    rmSync(paseoHome, { recursive: true, force: true });
  });

  function writeLayout(name: string, contents: string): void {
    const directory = path.join(paseoHome, PANE_LAYOUTS_DIRNAME);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, name), contents, "utf8");
  }

  it("returns nothing when there is no layouts directory", () => {
    expect(loadPaneLayouts(paseoHome)).toEqual({ layouts: [], errors: [] });
  });

  it("loads every layout sorted by file stem, with the stem as the id", () => {
    writeLayout("review.json", JSON.stringify({ name: "Review", root: {} }));
    writeLayout(
      "cockpit.json",
      JSON.stringify({ name: "Cockpit", root: { direction: "row", children: [{}, {}] } }),
    );

    expect(loadPaneLayouts(paseoHome)).toEqual({
      layouts: [
        { id: "cockpit", name: "Cockpit", root: { direction: "row", children: [{}, {}] } },
        { id: "review", name: "Review", root: {} },
      ],
      errors: [],
    });
  });

  it("skips an unparseable file and still loads its siblings", () => {
    writeLayout("good.json", JSON.stringify({ name: "Good", root: {} }));
    writeLayout("broken.json", "{ not json");

    const result = loadPaneLayouts(paseoHome);
    expect(result.layouts).toEqual([{ id: "good", name: "Good", root: {} }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^broken\.json: /);
  });

  it("skips a file that fails the schema and names it", () => {
    writeLayout("nameless.json", JSON.stringify({ root: {} }));

    const result = loadPaneLayouts(paseoHome);
    expect(result.layouts).toEqual([]);
    expect(result.errors).toEqual([
      "nameless.json: name: Invalid input: expected string, received undefined",
    ]);
  });

  it("rejects a misspelled direction rather than silently collapsing it to one pane", () => {
    // The trap the structural check exists for: this passes the schema's leaf arm.
    writeLayout(
      "typo.json",
      JSON.stringify({ name: "Typo", root: { directon: "row", children: [{}, {}] } }),
    );

    expect(loadPaneLayouts(paseoHome)).toEqual({
      layouts: [],
      errors: ['typo.json: root has "children" but no "direction" ("row" or "column")'],
    });
  });

  it("ignores entries that are not .json", () => {
    writeLayout("notes.md", "# not a layout");
    writeLayout("real.json", JSON.stringify({ name: "Real", root: {} }));

    expect(loadPaneLayouts(paseoHome)).toEqual({
      layouts: [{ id: "real", name: "Real", root: {} }],
      errors: [],
    });
  });
});
