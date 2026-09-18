import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { isPlatform } from "../test-utils/platform.js";

// `/usr/bin/which` is the PATH enumerator on POSIX. Only a real non-zero exit from it means
// "not on PATH"; our own SIGKILL timeout and spawn failures say nothing about the binary.
// This harness makes that one command fail in each of those shapes while every other spawn
// (notably probeExecutable's `--version`) keeps running for real.
type WhichFailure = { killed: true; code: null } | { code: number } | { code: string };

let whichFailure: WhichFailure | null = null;

vi.mock("../utils/spawn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/spawn.js")>();
  return {
    ...actual,
    execCommand: (command: string, args?: string[], options?: unknown) => {
      if (whichFailure && command === "/usr/bin/which") {
        return Promise.reject(Object.assign(new Error("which failed"), whichFailure));
      }
      return actual.execCommand(command, args, options as never);
    },
  };
});

const { findExecutable } = await import("./executable-resolution.js");

const originalPath = process.env.PATH;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paseo-which-fallback-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeRunnable(dir: string, name: string): string {
  const filePath = isPlatform("win32") ? path.join(dir, `${name}.cmd`) : path.join(dir, name);
  writeFileSync(
    filePath,
    isPlatform("win32") ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  );
  if (!isPlatform("win32")) {
    chmodSync(filePath, 0o755);
  }
  return filePath;
}

beforeEach(() => {
  whichFailure = null;
});

afterEach(() => {
  whichFailure = null;
  process.env.PATH = originalPath;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("findExecutable when /usr/bin/which fails", () => {
  test("a timed-out which falls back to the in-process PATH scan instead of reporting the binary missing", async () => {
    const dir = makeTempDir();
    const executablePath = writeRunnable(dir, "paseo-which-fallback-tool");
    process.env.PATH = [dir, originalPath].filter(Boolean).join(path.delimiter);
    whichFailure = { killed: true, code: null };

    await expect(findExecutable("paseo-which-fallback-tool")).resolves.toBe(executablePath);
  });

  test("a which that fails to spawn falls back to the in-process PATH scan", async () => {
    const dir = makeTempDir();
    const executablePath = writeRunnable(dir, "paseo-which-spawn-fail-tool");
    process.env.PATH = [dir, originalPath].filter(Boolean).join(path.delimiter);
    whichFailure = { code: "EAGAIN" };

    await expect(findExecutable("paseo-which-spawn-fail-tool")).resolves.toBe(executablePath);
  });

  test("a non-zero exit from which still means the binary is absent", async () => {
    const dir = makeTempDir();
    process.env.PATH = [dir, originalPath].filter(Boolean).join(path.delimiter);
    whichFailure = { code: 1 };

    await expect(findExecutable("paseo-which-absent-tool")).resolves.toBeNull();
  });
});
