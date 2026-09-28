import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeAgyConversationMedia, sanitizeImageBuffer, sanitizeImageFile } from "./media.js";

const VALID_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const VALID_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID_GIF_BYTES = Buffer.from("GIF89a\x01\x00\x01\x00");
const VALID_WEBP_BYTES = Buffer.from(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "base64",
);

describe("sanitizeImageBuffer", () => {
  it("returns null when the buffer already starts with valid magic bytes", () => {
    expect(sanitizeImageBuffer(VALID_PNG_BYTES, ".png")).toBeNull();
    expect(sanitizeImageBuffer(VALID_JPEG_BYTES, ".jpg")).toBeNull();
    expect(sanitizeImageBuffer(VALID_GIF_BYTES, ".gif")).toBeNull();
    expect(sanitizeImageBuffer(VALID_WEBP_BYTES, ".webp")).toBeNull();
  });

  it("slices prepended warning text when PNG magic bytes appear at an offset", () => {
    const warning = Buffer.from("[Warning] Multiple displays were found!\n");
    const corrupted = Buffer.concat([warning, VALID_PNG_BYTES]);

    const sanitized = sanitizeImageBuffer(corrupted, ".png");
    expect(sanitized).not.toBeNull();
    expect(sanitized).toEqual(VALID_PNG_BYTES);
  });

  it("slices prepended warning text for JPEG, GIF, and WebP", () => {
    const warning = Buffer.from("Download started...\n");
    const corruptedJpeg = Buffer.concat([warning, VALID_JPEG_BYTES]);
    const corruptedGif = Buffer.concat([warning, VALID_GIF_BYTES]);
    const corruptedWebp = Buffer.concat([warning, VALID_WEBP_BYTES]);

    expect(sanitizeImageBuffer(corruptedJpeg, ".jpeg")).toEqual(VALID_JPEG_BYTES);
    expect(sanitizeImageBuffer(corruptedGif, ".gif")).toEqual(VALID_GIF_BYTES);
    expect(sanitizeImageBuffer(corruptedWebp, ".webp")).toEqual(VALID_WEBP_BYTES);
  });

  it("returns fallback 1x1 image for temp storage when buffer is empty or corrupted text", () => {
    const textBuffer = Buffer.from("Error: 404 Not Found");
    const emptyBuffer = Buffer.alloc(0);

    const sanitizedPng = sanitizeImageBuffer(textBuffer, ".png", true);
    expect(sanitizedPng).not.toBeNull();
    expect(sanitizedPng!.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const sanitizedEmptyWebp = sanitizeImageBuffer(emptyBuffer, ".webp", true);
    expect(sanitizedEmptyWebp).not.toBeNull();
    expect(sanitizedEmptyWebp!.subarray(0, 4)).toEqual(Buffer.from("RIFF"));
    expect(sanitizedEmptyWebp!.subarray(8, 12)).toEqual(Buffer.from("WEBP"));
  });

  it("returns null for non-temp files when buffer has no image header", () => {
    const textBuffer = Buffer.from("Error: 404 Not Found");
    expect(sanitizeImageBuffer(textBuffer, ".png", false)).toBeNull();
  });
});

describe("sanitizeImageFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-test-file-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("modifies file in-place when corrupt prefix is found", () => {
    const filePath = join(tempDir, "test.png");
    const warning = Buffer.from("[Warning] Display error\n");
    writeFileSync(filePath, Buffer.concat([warning, VALID_PNG_BYTES]));

    expect(sanitizeImageFile(filePath, false)).toBe(true);
    expect(readFileSync(filePath)).toEqual(VALID_PNG_BYTES);
  });

  it("returns false and leaves file untouched when already valid", () => {
    const filePath = join(tempDir, "valid.png");
    writeFileSync(filePath, VALID_PNG_BYTES);

    expect(sanitizeImageFile(filePath, false)).toBe(false);
    expect(readFileSync(filePath)).toEqual(VALID_PNG_BYTES);
  });

  it("returns false for non-existent file", () => {
    expect(sanitizeImageFile(join(tempDir, "missing.png"))).toBe(false);
  });
});

describe("sanitizeAgyConversationMedia", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "paseo-test-home-"));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("sanitizes corrupted media in both .tempmediaStorage and brain root", () => {
    const conversationId = "test-conv-123";
    const brainDir = join(tempHome, ".gemini", "antigravity-cli", "brain", conversationId);
    const tempStorage = join(brainDir, ".tempmediaStorage");
    mkdirSync(tempStorage, { recursive: true });

    const warning = Buffer.from("[Warning] Multiple displays were found!\n");
    const screenPath = join(brainDir, "android_screen.png");
    const mediaPath = join(tempStorage, "media_123.png");
    const brokenPath = join(tempStorage, "media_bad.png");

    writeFileSync(screenPath, Buffer.concat([warning, VALID_PNG_BYTES]));
    writeFileSync(mediaPath, Buffer.concat([warning, VALID_PNG_BYTES]));
    writeFileSync(brokenPath, Buffer.from("Corrupt text without image bytes"));

    const count = sanitizeAgyConversationMedia(conversationId, tempHome);
    expect(count).toBe(3);

    // android_screen.png was sliced
    const fixedScreen = readFileSync(screenPath);
    expect(fixedScreen.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    // media_123.png was sliced
    const fixedMedia = readFileSync(mediaPath);
    expect(fixedMedia.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    // media_bad.png was replaced with fallback 1x1 PNG
    const fixedBad = readFileSync(brokenPath);
    expect(fixedBad.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("ignores non-image files and sanitizes scratch directory images", () => {
    const conversationId = "test-conv-456";
    const brainDir = join(tempHome, ".gemini", "antigravity-cli", "brain", conversationId);
    const scratchDir = join(brainDir, "scratch");
    mkdirSync(scratchDir, { recursive: true });

    const textPath = join(brainDir, "notes.txt");
    const jsonPath = join(scratchDir, "data.json");
    writeFileSync(textPath, "Some text notes");
    writeFileSync(jsonPath, '{"key": "value"}');

    const warning = Buffer.from("[Warning] ADB notice\n");
    const scratchPng = join(scratchDir, "device.png");
    writeFileSync(scratchPng, Buffer.concat([warning, VALID_PNG_BYTES]));

    const count = sanitizeAgyConversationMedia(conversationId, tempHome);
    expect(count).toBe(1);

    expect(readFileSync(textPath, "utf8")).toBe("Some text notes");
    expect(readFileSync(jsonPath, "utf8")).toBe('{"key": "value"}');
    expect(readFileSync(scratchPng).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
