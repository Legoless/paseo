import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_UI_FONT_STACK } from "@/styles/theme";
import { resolveWebUiFontStack, sanitizeCssFontStack } from "./apply-root-font.web";

describe("resolveWebUiFontStack", () => {
  it("keeps a stack that advances on a space", () => {
    expect(resolveWebUiFontStack("Menlo", 4)).toBe("Menlo");
  });

  it("rejects Android's typeface name so CSS cannot load a font called normal", () => {
    expect(resolveWebUiFontStack("normal", 4)).toBe(DEFAULT_WEB_UI_FONT_STACK);
  });

  it("rejects a stack whose space glyph has no advance", () => {
    expect(resolveWebUiFontStack("IconFont", 0)).toBe(DEFAULT_WEB_UI_FONT_STACK);
  });

  it("strips CSS breakout characters before choosing a stack", () => {
    expect(sanitizeCssFontStack("Menlo{}")).toBe("Menlo");
    expect(resolveWebUiFontStack("Menlo{}", 4)).toBe("Menlo");
  });
});
