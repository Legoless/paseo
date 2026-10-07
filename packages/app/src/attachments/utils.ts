import { generateMessageId } from "@/types/stream";
import { isAbsolutePath } from "@/utils/path";
import { isRasterImageMimeType } from "./file-types";

export function generateAttachmentId(): string {
  return `att_${generateMessageId()}`;
}

export function normalizeMimeType(input: string | undefined | null): string {
  if (!input) {
    return "image/jpeg";
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : "image/jpeg";
}

export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:([^,]*),([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error("Malformed data URL for attachment.");
  }
  const metadata = match[1] ?? "";
  const base64 = match[2]?.replace(/\s/g, "");
  const [mimeTypeRaw, ...parameters] = metadata.split(";").map((part) => part.trim());
  const isBase64 = parameters.some((part) => part.toLowerCase() === "base64");
  if (!isBase64) {
    throw new Error("Attachment data URL is not base64 encoded.");
  }
  if (!base64) {
    throw new Error("Attachment data URL is missing base64 payload.");
  }
  return {
    mimeType: normalizeMimeType(mimeTypeRaw),
    base64,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function parseImageDataUrl(
  uri: string,
): { mimeType: string; base64: string; cacheKey: string } | null {
  if (!uri.trim().toLowerCase().startsWith("data:image/")) {
    return null;
  }

  try {
    const parsed = parseDataUrl(uri);
    if (!isRasterImageMimeType(parsed.mimeType)) {
      return null;
    }
    const fingerprint = `${parsed.mimeType}\0${parsed.base64}`;
    return {
      ...parsed,
      cacheKey: `data-image:${parsed.mimeType}:${parsed.base64.length}:${hashString(fingerprint)}`,
    };
  } catch {
    return null;
  }
}

export function createImageSourceCacheKey(source: string): string {
  return parseImageDataUrl(source)?.cacheKey ?? source;
}

export function getFileNameFromPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  const fileName = normalized.split("/").pop()?.trim();
  return fileName || null;
}

export function createPreviewAttachmentId(input: {
  mimeType: string;
  path?: string | null;
  size?: number | null;
  modifiedAt?: string | null;
  contentLength?: number | null;
  contentKey?: string | null;
}): string {
  const path = input.path?.trim() ?? "";
  const size = Number.isFinite(input.size) ? String(input.size) : "";
  const modifiedAt = input.modifiedAt?.trim() ?? "";
  const contentLength = Number.isFinite(input.contentLength) ? String(input.contentLength) : "";
  const contentKey = input.contentKey?.trim() ?? "";
  const identity = `${input.mimeType}\0${path}\0${size}\0${modifiedAt}\0${contentLength}`;
  const hash = hashString(contentKey ? `${identity}\0${contentKey}` : identity);
  return `preview_${size || contentLength || "unknown"}_${hash}`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected FileReader result while encoding attachment."));
        return;
      }
      const payload = reader.result.split(",", 2)[1];
      if (!payload) {
        reject(new Error("Attachment FileReader result did not contain base64 payload."));
        return;
      }
      resolve(payload);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read attachment blob."));
    });
    reader.readAsDataURL(blob);
  });
}

export function pathToFileUri(path: string): string {
  if (path.startsWith("file://")) {
    return path;
  }

  if (!isAbsolutePath(path)) {
    return path;
  }

  if (path.startsWith("/")) {
    return `file://${path}`;
  }

  // UNC paths: \\server\share -> file://server/share
  if (path.startsWith("\\\\")) {
    return `file:${path.replace(/\\/g, "/")}`;
  }

  return `file:///${path.replace(/\\/g, "/")}`;
}

function isHexDigit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9A-Fa-f]$/.test(value);
}

function textFromPercentBytes(bytes: number[]): string | null {
  let encoded = "";
  for (const byte of bytes) {
    encoded += `%${byte.toString(16).padStart(2, "0")}`;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function isUnsafeDecodedText(text: string, allowSeparators: boolean): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
    if (!allowSeparators && (char === "/" || char === "\\")) {
      return true;
    }
  }
  return false;
}

// Decode complete %HH runs and leave a bare "%" in place. One broken escape used to keep the
// whole path encoded, so a space later in the same destination never became a space.
function decodePercentEscapes(segment: string, allowSeparators: boolean): string {
  if (!segment.includes("%")) {
    return segment;
  }
  let decoded = "";
  for (let index = 0; index < segment.length; ) {
    if (
      !isHexDigit(segment[index + 1]) ||
      !isHexDigit(segment[index + 2]) ||
      segment[index] !== "%"
    ) {
      decoded += segment[index];
      index += 1;
      continue;
    }
    const start = index;
    const bytes: number[] = [];
    while (
      segment[index] === "%" &&
      isHexDigit(segment[index + 1]) &&
      isHexDigit(segment[index + 2])
    ) {
      bytes.push(Number.parseInt(segment.slice(index + 1, index + 3), 16));
      index += 3;
    }
    const text = textFromPercentBytes(bytes);
    if (text === null || isUnsafeDecodedText(text, allowSeparators)) {
      decoded += segment.slice(start, index);
      continue;
    }
    decoded += text;
  }
  return decoded;
}

function decodeFilePathSource(source: string): string {
  return source
    .split("/")
    .map((segment) => decodePercentEscapes(segment, true))
    .join("/");
}

const MARKDOWN_FILE_PATH_DECODE_LIMIT = 2;

function decodeMarkdownFilePath(path: string): string {
  if (!path.includes("%")) {
    return path;
  }
  return path
    .split(/([\\/])/)
    .map((part) => {
      if (part === "/" || part === "\\") {
        return part;
      }
      const decoded = decodePercentEscapes(part, false);
      // An encoded dot segment would be a different path. Leave that segment written as it was.
      return decoded === "." || decoded === ".." ? part : decoded;
    })
    .join("");
}

// Markdown destinations are URLs, so a space arrives as %20 and a twice-encoded space as %2520.
// The most decoded spelling comes first. "%2F" and ".." stay as written: a Grok session directory
// is named with encoded slashes, and decoding those would point at a different path.
export function markdownFilePathCandidates(path: string): string[] {
  const chain = [path];
  let current = path;
  for (let pass = 0; pass < MARKDOWN_FILE_PATH_DECODE_LIMIT; pass += 1) {
    const decoded = decodeMarkdownFilePath(current);
    if (decoded === current) {
      break;
    }
    chain.push(decoded);
    current = decoded;
  }
  const candidates: string[] = [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index];
    if (candidate !== undefined && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function normalizeWindowsDrivePath(path: string): string {
  if (!/^[A-Za-z]:[\\/]/.test(path)) {
    return path;
  }
  return path.replace(/\\/g, "/");
}

function isMarkdownEncodedWindowsDrivePath(source: string): boolean {
  return /^[A-Za-z]:(?:%5[Cc]|%2[Ff])/.test(source);
}

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const fileSource = uri.slice("file://".length);
  const decodedPath = decodeFilePathSource(fileSource);
  if (!fileSource.startsWith("/")) {
    return `\\\\${decodedPath.replace(/\//g, "\\")}`;
  }
  return normalizeWindowsDrivePath(decodedPath.replace(/^\/([A-Za-z]:[\\/])/, "$1"));
}

export function localFileSourceToPath(source: string): string {
  let path = source;
  if (source.startsWith("file://")) {
    path = fileUriToPath(source);
  } else if (isMarkdownEncodedWindowsDrivePath(source)) {
    path = decodeFilePathSource(source);
  }
  return normalizeWindowsDrivePath(path);
}

export function getFileExtensionFromName(fileName: string | null | undefined): string {
  if (!fileName) {
    return "";
  }
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0 || idx === fileName.length - 1) {
    return "";
  }
  return fileName.slice(idx);
}
