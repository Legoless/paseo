import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parsePaneLayoutFile, type PaneLayout } from "@getpaseo/protocol/workspace-layouts";

/** Directory under `$PASEO_HOME` holding one JSON file per pane layout. */
export const PANE_LAYOUTS_DIRNAME = "layouts";

export interface LoadedPaneLayouts {
  layouts: PaneLayout[];
  /** One line per unusable file, already formatted for display: `review.json: root: ...`. */
  errors: string[];
}

/**
 * Reads every `*.json` under `$PASEO_HOME/layouts/`, newest parse wins nothing — the file stem is
 * the layout id, so a rename is a new layout and an edit is the same one.
 *
 * One bad file is skipped rather than fatal, and its message is returned instead of logged into a
 * void: the app renders these as hints in the layout menu, which is the whole difference between
 * this and a layout that silently fails to appear.
 */
export function loadPaneLayouts(paseoHome: string): LoadedPaneLayouts {
  const directory = path.join(paseoHome, PANE_LAYOUTS_DIRNAME);

  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // No layouts directory is the normal case, not an error worth surfacing.
    return { layouts: [], errors: [] };
  }

  const layouts: PaneLayout[] = [];
  const errors: string[] = [];

  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const id = path.basename(entry, ".json");
    if (!id) {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(path.join(directory, entry), "utf8");
    } catch (error) {
      errors.push(`${entry}: ${error instanceof Error ? error.message : "could not be read"}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push(`${entry}: ${error instanceof Error ? error.message : "is not valid JSON"}`);
      continue;
    }

    const result = parsePaneLayoutFile(parsed);
    if (!result.ok) {
      errors.push(`${entry}: ${result.error}`);
      continue;
    }

    layouts.push({ ...result.data, id });
  }

  return { layouts, errors };
}
