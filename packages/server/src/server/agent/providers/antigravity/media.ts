import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { resolveAgyCliHome } from "./sessions.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A_MAGIC = Buffer.from("GIF87a");
const GIF89A_MAGIC = Buffer.from("GIF89a");
const WEBP_MAGIC = Buffer.from("RIFF");
const WEBP_SUBTYPE = Buffer.from("WEBP");

// Minimal 1x1 transparent 32-bit PNG fallback
const FALLBACK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// Minimal 1x1 JPEG fallback
const FALLBACK_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

// Minimal 1x1 transparent GIF fallback
const FALLBACK_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

// Minimal 1x1 WebP fallback
const FALLBACK_WEBP = Buffer.from(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "base64",
);

function getImageFallback(ext: string): Buffer | null {
  if (ext === ".png") return FALLBACK_PNG;
  if (ext === ".jpg" || ext === ".jpeg") return FALLBACK_JPEG;
  if (ext === ".gif") return FALLBACK_GIF;
  if (ext === ".webp") return FALLBACK_WEBP;
  return null;
}

function isBufferValidImage(data: Buffer, ext: string): boolean {
  if (ext === ".png") {
    return data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return data.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
  }
  if (ext === ".gif") {
    return data.subarray(0, 6).equals(GIF87A_MAGIC) || data.subarray(0, 6).equals(GIF89A_MAGIC);
  }
  if (ext === ".webp") {
    return data.subarray(0, 4).equals(WEBP_MAGIC) && data.subarray(8, 12).equals(WEBP_SUBTYPE);
  }
  return false;
}

function findWebpOffset(data: Buffer): number {
  let search = 0;
  while (search < data.length - 12) {
    const riffIdx = data.indexOf(WEBP_MAGIC, search);
    if (riffIdx === -1) break;
    if (data.subarray(riffIdx + 8, riffIdx + 12).equals(WEBP_SUBTYPE)) {
      return riffIdx;
    }
    search = riffIdx + 1;
  }
  return -1;
}

function findGifOffset(data: Buffer): number {
  const off87 = data.indexOf(GIF87A_MAGIC);
  const off89 = data.indexOf(GIF89A_MAGIC);
  if (off87 !== -1 && off89 !== -1) return Math.min(off87, off89);
  return off87 !== -1 ? off87 : off89;
}

function findMagicOffset(data: Buffer, ext: string): number {
  if (ext === ".png") return data.indexOf(PNG_MAGIC);
  if (ext === ".jpg" || ext === ".jpeg") return data.indexOf(JPEG_MAGIC);
  if (ext === ".gif") return findGifOffset(data);
  if (ext === ".webp") return findWebpOffset(data);
  return -1;
}

export function sanitizeImageBuffer(
  data: Buffer,
  ext: string,
  isTempStorage = false,
): Buffer | null {
  const normalizedExt = ext.toLowerCase();
  const fallback = getImageFallback(normalizedExt);
  if (!fallback) {
    return null;
  }

  if (isBufferValidImage(data, normalizedExt)) {
    return null;
  }

  const offset = findMagicOffset(data, normalizedExt);
  if (offset > 0) {
    return data.subarray(offset);
  }

  if (isTempStorage) {
    return fallback;
  }

  return null;
}

const SUPPORTED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export function sanitizeImageFile(filePath: string, isTempStorage = false): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTS.has(ext)) return false;
  if (!existsSync(filePath)) return false;

  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return false;
  }

  const sanitized = sanitizeImageBuffer(data, ext, isTempStorage);
  if (!sanitized) return false;

  try {
    writeFileSync(filePath, sanitized);
    return true;
  } catch {
    return false;
  }
}

function sanitizeDirectoryImages(dir: string, isTempStorage: boolean): number {
  if (!existsSync(dir)) return 0;
  let fixedCount = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = join(dir, entry.name);
      if (sanitizeImageFile(fullPath, isTempStorage)) {
        fixedCount += 1;
      }
    }
  } catch {}
  return fixedCount;
}

export function sanitizeAgyConversationMedia(conversationId: string, homeDir?: string): number {
  const brainDir = join(resolveAgyCliHome(homeDir), "brain", conversationId);
  if (!existsSync(brainDir)) return 0;

  const dirsToScan = [
    { dir: join(brainDir, ".tempmediaStorage"), isTempStorage: true },
    { dir: brainDir, isTempStorage: false },
    { dir: join(brainDir, "scratch"), isTempStorage: false },
    { dir: join(brainDir, ".user_uploaded"), isTempStorage: false },
  ];

  let fixedCount = 0;
  for (const { dir, isTempStorage } of dirsToScan) {
    fixedCount += sanitizeDirectoryImages(dir, isTempStorage);
  }

  return fixedCount;
}
