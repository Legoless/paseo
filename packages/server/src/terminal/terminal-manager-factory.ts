import type { TerminalManager } from "./terminal-manager.js";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";

export interface ConfiguredTerminalManagerOptions {
  getTerminalActivityUrl?: () => string | null;
  // Runs before each terminal is created, in the daemon process.
  onCreateTerminal?: () => void;
}

export function createConfiguredTerminalManager(
  options: ConfiguredTerminalManagerOptions = {},
): TerminalManager {
  return createWorkerTerminalManager(options);
}
