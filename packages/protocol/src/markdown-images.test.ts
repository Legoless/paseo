import { describe, expect, test } from "vitest";
import { extractMarkdownImages } from "./markdown-images.js";

describe("extractMarkdownImages", () => {
  test("extracts embeds in order with trimmed alt text", () => {
    expect(
      extractMarkdownImages("![ One ](/tmp/one.png)\n\ntext ![](https://example.com/two)"),
    ).toEqual([
      { source: "/tmp/one.png", alt: "One" },
      { source: "https://example.com/two", alt: null },
    ]);
  });

  test("keeps an embed that follows a stray bracket or sits inside a badge link", () => {
    expect(
      extractMarkdownImages("[![build](https://img.shields.io/badge/x)](https://ci.example.com)"),
    ).toEqual([{ source: "https://img.shields.io/badge/x", alt: "build" }]);
    expect(
      extractMarkdownImages(
        "The regex `[a-z` is wrong, see [0, 5).\n\n![Screenshot](https://host/render?id=3)",
      ),
    ).toEqual([{ source: "https://host/render?id=3", alt: "Screenshot" }]);
  });

  test("unwraps angle-bracket sources and drops titles", () => {
    expect(
      extractMarkdownImages(
        "![Spaced](</tmp/my shot.png>) ![Titled](/tmp/a.png \"Title\") ![Single](b.png 't')",
      ),
    ).toEqual([
      { source: "/tmp/my shot.png", alt: "Spaced" },
      { source: "/tmp/a.png", alt: "Titled" },
      { source: "b.png", alt: "Single" },
    ]);
  });

  test("accepts plain links only when they target an image file", () => {
    expect(
      extractMarkdownImages(
        [
          "[shot](out/shot.PNG)",
          "[photo](https://example.com/p.jpeg?raw=1)",
          "[anim](a.gif#frame)",
          "[webp](c.webp)",
          "[jpg](d.jpg)",
          "[docs](https://example.com/readme.md)",
          "[page](https://example.com/png)",
        ].join("\n"),
      ),
    ).toEqual([
      { source: "out/shot.PNG", alt: "shot" },
      { source: "https://example.com/p.jpeg?raw=1", alt: "photo" },
      { source: "a.gif#frame", alt: "anim" },
      { source: "c.webp", alt: "webp" },
      { source: "d.jpg", alt: "jpg" },
    ]);
  });

  test("reads the escapes provider image output writes into alt text and paths", () => {
    expect(
      extractMarkdownImages(
        "![a \\] b \\\\ c](file:///tmp/shot\\).png) ![Image](C:\\\\Users\\\\me\\\\x.png)",
      ),
    ).toEqual([
      { source: "file:///tmp/shot).png", alt: "a ] b \\ c" },
      { source: "C:\\Users\\me\\x.png", alt: "Image" },
    ]);
  });

  test("ignores bare paths and empty sources", () => {
    expect(extractMarkdownImages("see /tmp/shot.png and ![x]( ) and ![y](<>)")).toEqual([]);
  });
});
