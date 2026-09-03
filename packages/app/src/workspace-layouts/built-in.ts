import type { PaneLayoutNode } from "@getpaseo/protocol/workspace-layouts";

/**
 * The layouts that ship with the app. They are ordinary pane-layout nodes and go through the same
 * builder as anything read from `$PASEO_HOME/layouts/`, which keeps the file format honest: if a
 * built-in stops parsing, the protocol test fails.
 */
export interface BuiltInPaneLayout {
  id: string;
  /** i18n key, not a literal: these are ours to translate. A layout read from disk
   * carries a user-authored `name`, which never is. */
  nameKey: string;
  /** Interpolation values for `nameKey`, for the grids that name their own dimensions. */
  nameParams?: Record<string, number>;
  root: PaneLayoutNode;
}

/**
 * `rows` stacked bands, each split into `columns` side-by-side panes — so a 3 × 7 grid is three
 * rows of seven, the way the label reads.
 */
function grid(rows: number, columns: number): BuiltInPaneLayout {
  return {
    id: `grid-${rows}x${columns}`,
    nameKey: "paneLayouts.builtIn.grid",
    nameParams: { rows, columns },
    root: {
      direction: "column",
      children: Array.from({ length: rows }, () => ({
        direction: "row" as const,
        children: Array.from({ length: columns }, () => ({})),
      })),
    },
  };
}

export const BUILT_IN_PANE_LAYOUTS: readonly BuiltInPaneLayout[] = [
  {
    id: "single",
    nameKey: "paneLayouts.builtIn.single",
    root: {},
  },
  {
    id: "two-columns",
    nameKey: "paneLayouts.builtIn.twoColumns",
    root: { direction: "row", children: [{}, {}] },
  },
  {
    id: "two-rows",
    nameKey: "paneLayouts.builtIn.twoRows",
    root: { direction: "column", children: [{}, {}] },
  },
  grid(2, 2),
  grid(2, 5),
  grid(2, 7),
  grid(3, 7),
];
