import type { TerminalClipboardWriter } from "@/terminal/native-renderer/terminal-selection";

export interface TerminalClipboardBridge {
  copyToClipboard?: (text: string) => Promise<boolean> | boolean;
}

/**
 * Guest focus makes the renderer's `navigator.clipboard` unreliable, so terminal copy prefers the
 * main-process bridge (the same reason `browser.copyElement` exists). The provided writer is only a
 * fallback for when the Electron bridge is absent.
 */
export function selectTerminalClipboardWriter(input: {
  bridge?: TerminalClipboardBridge;
  fallback: TerminalClipboardWriter;
}): TerminalClipboardWriter {
  const copyToClipboard = input.bridge?.copyToClipboard;
  if (typeof copyToClipboard !== "function") {
    return input.fallback;
  }
  return {
    writeText: async (text: string) => {
      await copyToClipboard(text);
    },
  };
}
