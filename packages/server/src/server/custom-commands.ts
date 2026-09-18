import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCustomCommandsFile, type CustomCommand } from "@getpaseo/protocol/custom-commands";

/** File name of both the global (`$PASEO_HOME`) and project (`.paseo-neo/`) commands files. */
export const CUSTOM_COMMANDS_FILENAME = "commands.json";

/** Directory at a project root holding project-scoped daemon-consumed files. */
export const PROJECT_PASEO_DIRNAME = ".paseo-neo";

export interface LoadedCustomCommands {
  commands: CustomCommand[];
  /** One formatted line when the file exists but cannot be used: `commands.json: <message>`. */
  errors: string[];
}

export type CustomCommandsFileRead =
  | { status: "missing" }
  | { status: "loaded"; commands: CustomCommand[] }
  | { status: "invalid"; error: string };

/**
 * Reads one commands file. A missing file (or missing parent directory) is the normal case, not
 * an error; anything present but unreadable, unparseable, or invalid comes back as one formatted
 * line so the caller can surface it instead of the file silently doing nothing.
 */
export function readCustomCommandsFile(filePath: string): CustomCommandsFileRead {
  const displayName = path.basename(filePath);

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing" };
    }
    return {
      status: "invalid",
      error: `${displayName}: ${error instanceof Error ? error.message : "could not be read"}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "invalid",
      error: `${displayName}: ${error instanceof Error ? error.message : "is not valid JSON"}`,
    };
  }

  const result = parseCustomCommandsFile(parsed);
  if (!result.ok) {
    return { status: "invalid", error: `${displayName}: ${result.error}` };
  }
  return { status: "loaded", commands: result.data.commands };
}

/**
 * Reads `$PASEO_HOME/commands.json`. Rescanned on every daemon config reload rather than watched,
 * same contract as the pane layouts in workspace-layouts.ts.
 */
export function loadCustomCommands(paseoHome: string): LoadedCustomCommands {
  const result = readCustomCommandsFile(path.join(paseoHome, CUSTOM_COMMANDS_FILENAME));
  switch (result.status) {
    case "missing":
      return { commands: [], errors: [] };
    case "invalid":
      return { commands: [], errors: [result.error] };
    case "loaded":
      return { commands: result.commands, errors: [] };
  }
}
