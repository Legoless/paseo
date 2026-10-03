import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

interface ExternalUrlOwner {
  open(url: string): Promise<void>;
}

interface FilePathOwner {
  open(path: string): Promise<string>;
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

const asExternalUrl = (input: unknown): URL | undefined => {
  if (typeof input !== "string" || !URL.canParse(input)) return undefined;
  const candidate = new URL(input);
  return EXTERNAL_PROTOCOLS.has(candidate.protocol) ? candidate : undefined;
};

export function createExternalUrlOpener(owner: ExternalUrlOwner) {
  return async (candidate: unknown): Promise<void> => {
    const url = asExternalUrl(candidate);
    if (url === undefined) {
      throw new Error("Only HTTP(S) URLs can open externally.");
    }
    return owner.open(url.href);
  };
}

export function createFilePathOpener(owner: FilePathOwner) {
  return async (candidate: unknown): Promise<void> => {
    if (typeof candidate !== "string" || candidate.includes("\0")) {
      throw new Error("Only absolute local paths can open in the default application.");
    }
    let filePath = candidate;
    if (candidate === "~") {
      filePath = homedir();
    } else if (candidate.startsWith("~/")) {
      filePath = join(homedir(), candidate.slice(2));
    }
    if (!isAbsolute(filePath)) {
      throw new Error("Only absolute local paths can open in the default application.");
    }
    const errorMessage = await owner.open(filePath);
    if (errorMessage) throw new Error(errorMessage);
  };
}
