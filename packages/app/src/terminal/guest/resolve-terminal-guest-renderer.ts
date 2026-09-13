export type IsolatedTerminalRendererSelection = "isolated" | "embedded";

/**
 * The isolated guest renderer is Electron-only. Everywhere else the setting is inert so web and
 * native observers never mount a `<webview>`.
 */
export function resolveIsolatedTerminalRenderer(input: {
  useIsolatedTerminalRenderer: boolean;
  isElectronRuntime: boolean;
}): IsolatedTerminalRendererSelection {
  return input.useIsolatedTerminalRenderer && input.isElectronRuntime ? "isolated" : "embedded";
}
