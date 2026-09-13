import { describe, expect, test, vi } from "vitest";
import { selectTerminalClipboardWriter } from "./copy-selection";

describe("selectTerminalClipboardWriter", () => {
  test("prefers the main-process clipboard bridge when available", async () => {
    const copyToClipboard = vi.fn(async () => true);
    const fallbackWriteText = vi.fn(async () => {});
    const writer = selectTerminalClipboardWriter({
      bridge: { copyToClipboard },
      fallback: { writeText: fallbackWriteText },
    });

    await writer.writeText("selected text");

    expect(copyToClipboard).toHaveBeenCalledWith("selected text");
    expect(fallbackWriteText).not.toHaveBeenCalled();
  });

  test("falls back to the provided writer when the bridge is unavailable", async () => {
    const fallbackWriteText = vi.fn(async () => {});
    const writer = selectTerminalClipboardWriter({
      bridge: undefined,
      fallback: { writeText: fallbackWriteText },
    });

    await writer.writeText("selected text");

    expect(fallbackWriteText).toHaveBeenCalledWith("selected text");
  });

  test("falls back when the bridge exists but does not expose copyToClipboard", async () => {
    const fallbackWriteText = vi.fn(async () => {});
    const writer = selectTerminalClipboardWriter({
      bridge: {},
      fallback: { writeText: fallbackWriteText },
    });

    await writer.writeText("selected text");

    expect(fallbackWriteText).toHaveBeenCalledWith("selected text");
  });
});
