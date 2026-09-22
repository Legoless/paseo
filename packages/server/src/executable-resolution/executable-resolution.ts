import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execCommand } from "../utils/spawn.js";
import { isWindowsCommandScript } from "../utils/windows-command.js";
import { windowsExecutableResolution } from "./windows.js";

export { quoteWindowsArgument, quoteWindowsCommand } from "../utils/windows-command.js";

type Which = (command: string, options: { all: true }) => Promise<string[]>;

const require = createRequire(import.meta.url);
const which = require("which") as Which;
const PROBE_TIMEOUT_MS = 2000;

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

async function enumerateCandidates(name: string): Promise<string[]> {
  if (process.platform !== "win32" && existsSync("/usr/bin/which")) {
    return enumerateCandidatesViaSystemWhich(name);
  }
  return enumerateCandidatesViaLibrary(name);
}

async function enumerateCandidatesViaSystemWhich(name: string): Promise<string[]> {
  try {
    const { stdout } = await execCommand("/usr/bin/which", ["-a", name], {
      timeout: 3000,
      killSignal: "SIGKILL",
    });
    return Array.from(new Set(stdout.trim().split("\n").filter(Boolean)));
  } catch (error) {
    // which exits 1 for a missing command. A failed lookup is not evidence of absence.
    if (error instanceof Error && "code" in error && error.code === 1) return [];
    // A SIGKILL from our timeout, or a spawn failure, says nothing about PATH.
    return enumerateCandidatesViaLibrary(name);
  }
}

async function enumerateCandidatesViaLibrary(name: string): Promise<string[]> {
  let candidates: string[];
  try {
    candidates = await which(name, { all: true });
  } catch (error) {
    // `which` throws ENOENT when the command is absent from PATH.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

export async function probeExecutable(
  executablePath: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await execCommand(executablePath, ["--version"], {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      shell: isWindowsCommandScript(executablePath),
    });
    return true;
  } catch (error) {
    return classifyProbeError(error);
  }
}

function classifyProbeError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & {
    killed?: boolean;
  };
  if (err.killed) {
    return true;
  }
  if (typeof err.code === "number") {
    return true;
  }
  if (
    err.code === "ENOENT" ||
    err.code === "EACCES" ||
    err.code === "ENOEXEC" ||
    err.code === "UNKNOWN"
  ) {
    return false;
  }
  return false;
}

/**
 * Check a literal executable path. PATH search is handled by findExecutable().
 */
export function executableExists(
  executablePath: string,
  exists: typeof existsSync = existsSync,
): string | null {
  if (process.platform === "win32") {
    return windowsExecutableResolution.exists(executablePath, { exists });
  }
  return exists(executablePath) ? executablePath : null;
}

// Feature lists and catalog refresh probe the same binaries on every request.
// The key includes PATH, so a shell-path change still discovers a newly installed CLI.
const EXECUTABLE_HIT_TTL_MS = 5 * 60 * 1000;
const EXECUTABLE_MISS_TTL_MS = 30 * 1000;

interface ExecutableLookup {
  value: string | null;
  expiresAt: number;
}

const executableLookupCache = new Map<string, ExecutableLookup>();
const executableLookupInflight = new Map<string, Promise<string | null>>();

function executableLookupKey(name: string, probeTimeoutMs: number): string {
  return [
    process.env.PATH ?? "",
    process.platform === "win32" ? (process.env.PATHEXT ?? "") : "",
    name,
    String(probeTimeoutMs),
  ].join("\0");
}

export async function findExecutable(
  name: string,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  const key = executableLookupKey(trimmed, probeTimeoutMs);
  const cached = executableLookupCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const inflight = executableLookupInflight.get(key);
  if (inflight) {
    return inflight;
  }

  const lookup = lookupExecutable(trimmed, probeTimeoutMs).then((value) => {
    executableLookupCache.set(key, {
      value,
      expiresAt: Date.now() + (value === null ? EXECUTABLE_MISS_TTL_MS : EXECUTABLE_HIT_TTL_MS),
    });
    return value;
  });
  executableLookupInflight.set(key, lookup);
  void lookup.finally(() => {
    if (executableLookupInflight.get(key) === lookup) {
      executableLookupInflight.delete(key);
    }
  });
  return lookup;
}

async function lookupExecutable(trimmed: string, probeTimeoutMs: number): Promise<string | null> {
  if (process.platform === "win32") {
    return windowsExecutableResolution.find(trimmed, {
      enumeratePathCandidates: enumerateCandidates,
      probeExecutable,
      exists: existsSync,
      probeTimeoutMs,
    });
  }

  if (hasPathSeparator(trimmed)) {
    return (await probeExecutable(trimmed, probeTimeoutMs)) ? trimmed : null;
  }

  const candidates = await enumerateCandidates(trimmed);
  for (const candidate of candidates) {
    if (await probeExecutable(candidate, probeTimeoutMs)) {
      return candidate;
    }
  }
  return null;
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await findExecutable(command)) !== null;
}
