import { afterEach, describe, expect, it, vi } from "vitest";
import { isFileLookingAssistantToken } from "@/assistant-file-links/parse";
import {
  assistantMarkdownParser,
  streamingAssistantMarkdownParser,
} from "@/utils/assistant-markdown-parser";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import {
  ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT,
  capAssistantMessageForRender,
  getUtf8ByteLength,
} from "./assistant-message-render-limit";

function parseCappedMessage(message: string) {
  const { text, capped } = capAssistantMessageForRender(message);
  const blocks = splitMarkdownBlocks(text);
  return blocks.flatMap((block, index) => {
    const lastBlock = index === blocks.length - 1;
    const parser = capped && lastBlock ? streamingAssistantMarkdownParser : assistantMarkdownParser;
    const source = lastBlock && text.endsWith("\n") && !block.endsWith("\n") ? `${block}\n` : block;
    return parser.parse(source, {}).flatMap((token) => token.children ?? []);
  });
}

function getCappedLinkTargets(message: string) {
  return parseCappedMessage(message)
    .filter((token) => token.type === "link_open")
    .map((token) => token.attrGet("href"));
}

describe("assistant message render limit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("leaves messages at the limit unchanged", () => {
    const message = "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT);

    expect(capAssistantMessageForRender(message)).toEqual({ text: message, capped: false });
  });

  it("caps oversized messages before markdown rendering", () => {
    const message = "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT + 1);

    expect(capAssistantMessageForRender(message)).toEqual({
      text: "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT),
      capped: true,
    });
  });

  it.each([
    "https://example.com/a/very-long-artifact-file-name.html",
    "[report](https://example.com/a/very-long-artifact-file-name.html)",
    "[example.com](https://example.com/a/very-long-artifact-file-name.html)",
    "[report](</tmp/My Report/very-long-artifact-file-name.html>)",
  ])("does not make a truncated first-line destination clickable: %s", (source) => {
    const message = "x ".repeat(15_980) + source;

    expect(capAssistantMessageForRender(message).capped).toBe(true);
    expect(getCappedLinkTargets(message)).toEqual([]);
  });

  it("marks a capped inline file path as provisional until its closing backtick arrives", () => {
    const message = "x ".repeat(15_980) + "`~/Downloads/very-long-artifact-file-name.html`";
    const code = parseCappedMessage(message).find((token) => token.type === "code_inline");

    expect(code).toBeDefined();
    expect(isFileLookingAssistantToken(code!.content)).toBe(true);
    expect(code!.info).toBe("streaming");
  });

  it.each([
    "[ref]: https://example.com/a/very-long-artifact-file-name.html",
    "  [ref]: https://example.com/a/very-long-artifact-file-name.html",
    "[ref]:\n  https://example.com/a/very-long-artifact-file-name.html",
    "[ref]: <file:///tmp/a/very-long-artifact-file-name.html>",
    "[ref]:\n  <file:///tmp/My Report/very-long-artifact-file-name.html>",
  ])("does not resolve references to a capped destination: %s", (definition) => {
    const message = `${"x ".repeat(15_975)}[report][ref]\n\n${definition}`;

    expect(capAssistantMessageForRender(message).capped).toBe(true);
    expect(getCappedLinkTargets(message)).toEqual([]);
  });

  it("keeps an earlier complete reference when a duplicate definition is capped", () => {
    const prefix = `[report][ref]\n\n[ref]: https://example.com/complete\n\n${"x ".repeat(15_940)}\n\n`;
    const message = `${prefix}[ref]: https://example.com/${"a".repeat(100)}.html`;

    expect(capAssistantMessageForRender(message).capped).toBe(true);
    expect(new Set(getCappedLinkTargets(message))).toEqual(
      new Set(["https://example.com/complete"]),
    );
  });

  it("keeps complete earlier URLs when the last destination is capped", () => {
    const message = `https://example.com/complete\n\n${"x ".repeat(15_950)}https://example.com/${"a".repeat(100)}.html`;

    expect(getCappedLinkTargets(message)).toEqual(["https://example.com/complete"]);
  });

  it.each(["😀", "é", "👨‍👩‍👧‍👦", "👍🏽", "❤️", "🇺🇸", "가", "कः"])(
    "does not split %s at the render limit",
    (cluster) => {
      for (let offset = 1; offset < cluster.length; offset++) {
        const prefix = "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT - offset);
        expect(capAssistantMessageForRender(`${prefix}${cluster}tail`)).toEqual({
          text: prefix,
          capped: true,
        });
      }
    },
  );

  it("does not split a grapheme cluster at the boundary", () => {
    const prefix = "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT - 1);

    expect(capAssistantMessageForRender(`${prefix}étail`)).toEqual({
      text: prefix,
      capped: true,
    });
  });

  it("counts the complete message size in UTF-8 bytes", () => {
    expect(getUtf8ByteLength("aé😀")).toBe(7);
  });

  it("keeps a bounded prefix when grapheme segmentation is unavailable", async () => {
    vi.resetModules();
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const { capAssistantMessageForRender: capWithoutSegmenter } =
      await import("./assistant-message-render-limit");
    const message = "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT + 1);

    expect(capWithoutSegmenter(message)).toEqual({
      text: "a".repeat(ASSISTANT_MESSAGE_RENDER_CHARACTER_LIMIT),
      capped: true,
    });
  });
});
