import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgyUserPrompt } from "./prompt.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("buildAgyUserPrompt", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("passes a string prompt through unchanged", () => {
    expect(buildAgyUserPrompt("hello")).toEqual({ text: "hello", imagePaths: [] });
  });

  it("joins text and file attachments without image blocks", () => {
    const prepared = buildAgyUserPrompt([
      { type: "text", text: "Look at this" },
      {
        type: "uploaded_file",
        id: "file-1",
        fileName: "notes.txt",
        mimeType: "text/plain",
        size: 4,
        path: "/tmp/notes.txt",
      },
    ]);
    expect(prepared.imagePaths).toEqual([]);
    expect(prepared.text).toContain("Look at this");
    expect(prepared.text).toContain("Path: /tmp/notes.txt");
  });

  it("writes images to disk and mentions the path in text", () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-prompt-"));
    dirs.push(dir);
    const prepared = buildAgyUserPrompt(
      [
        { type: "text", text: "Describe the image" },
        { type: "image", data: PNG_BASE64, mimeType: "image/png" },
      ],
      dir,
    );
    expect(prepared.imagePaths).toHaveLength(1);
    expect(prepared.text).toContain("Describe the image");
    expect(prepared.text).toContain(prepared.imagePaths[0]);
    expect(readFileSync(prepared.imagePaths[0]).length).toBeGreaterThan(0);
  });
});
