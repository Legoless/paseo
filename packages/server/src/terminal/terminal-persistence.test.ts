import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TerminalState } from "@getpaseo/protocol/messages";
import {
  buildTerminalRestoreInput,
  buildTerminalResumeInput,
  readTerminalRecords,
  renderRestoreScrollback,
  toTerminalResumeTarget,
  writeTerminalRecord,
  type TerminalRecord,
} from "./terminal-persistence.js";

function row(text: string, cols = 20): TerminalState["grid"][number] {
  return Array.from({ length: cols }, (_, index) => ({ char: text[index] ?? " " }));
}

function state(input: { scrollback: string[]; grid: string[]; cursorRow: number }): TerminalState {
  return {
    rows: input.grid.length,
    cols: 20,
    scrollback: input.scrollback.map((text) => row(text)),
    grid: input.grid.map((text) => row(text)),
    // A capture always carries wrap flags (includeWrapFlags), which lets the renderer keep autowrap.
    scrollbackWrapped: input.scrollback.map(() => false),
    gridWrapped: input.grid.map(() => false),
    cursor: { row: input.cursorRow, col: 2 },
  };
}

function record(overrides: Partial<TerminalRecord> = {}): TerminalRecord {
  return {
    version: 1,
    id: "term-1",
    workspaceId: "ws-1",
    cwd: "/tmp",
    name: "Terminal 1",
    rows: 24,
    cols: 80,
    savedAt: "2026-09-29T18:00:00.000Z",
    ...overrides,
  };
}

const temporaryDirs: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("renderRestoreScrollback", () => {
  it("keeps the rows up to the cursor and drops the old cursor placement", () => {
    const rendered = renderRestoreScrollback(
      state({ scrollback: ["old output"], grid: ["$ ls", "$ ", "", ""], cursorRow: 1 }),
    );

    expect(rendered).toBe("old output\r\n$ ls\r\n$\u001b[0m\u001b[?7h");
    // The old cursor sat at row 2, column 3 of the viewport.
    expect(rendered).not.toContain("\u001b[2;3H");
  });

  it("drops the oldest rows first when the output is too large", () => {
    const wide = "x".repeat(20);
    const scrollback = Array.from({ length: 25_000 }, () => wide);
    const rendered = renderRestoreScrollback(
      state({ scrollback: ["first row", ...scrollback], grid: ["last row"], cursorRow: 0 }),
    );

    expect(rendered.length).toBeLessThanOrEqual(400_000);
    expect(rendered.startsWith(wide)).toBe(true);
    expect(rendered).not.toContain("first row");
    expect(rendered).toContain("last row");
  });
});

describe("resume targets", () => {
  it("accepts Claude and Codex sessions with plain ids", () => {
    expect(toTerminalResumeTarget("claude", "0b6e-4c1a")).toEqual({
      agent: "claude",
      sessionId: "0b6e-4c1a",
    });
    expect(toTerminalResumeTarget("codex", "abc_123.x")).toEqual({
      agent: "codex",
      sessionId: "abc_123.x",
    });
  });

  it("rejects agents without a resume command and ids that are not safe to type", () => {
    expect(toTerminalResumeTarget("grok", "abc")).toBeNull();
    expect(toTerminalResumeTarget(null, "abc")).toBeNull();
    expect(toTerminalResumeTarget("claude", "abc; rm -rf ~")).toBeNull();
    // Typed after `--resume`, a leading dash would read as another flag.
    expect(toTerminalResumeTarget("claude", "--print")).toBeNull();
  });

  it("types each agent's own resume command, kept out of shell history", () => {
    expect(buildTerminalResumeInput({ agent: "claude", sessionId: "s1" })).toBe(
      " claude --resume s1\r",
    );
    expect(buildTerminalResumeInput({ agent: "codex", sessionId: "s1" })).toBe(
      " codex resume s1\r",
    );
  });
});

describe("buildTerminalRestoreInput", () => {
  it("resumes the agent instead of replaying its old screen", () => {
    expect(
      buildTerminalRestoreInput(
        record({ resume: { agent: "claude", sessionId: "s1" }, scrollback: "old" }),
      ),
    ).toEqual({ resume: { agent: "claude", sessionId: "s1" } });
  });

  it("seeds a plain terminal with its scrollback and a restore marker", () => {
    const { seed } = buildTerminalRestoreInput(record({ scrollback: "old output" }));

    expect(seed?.startsWith("old output\r\n")).toBe(true);
    expect(seed).toContain("Session restored from");
    expect(seed?.endsWith("\r\n")).toBe(true);
  });

  it("starts a terminal with nothing saved as a plain shell", () => {
    expect(buildTerminalRestoreInput(record())).toEqual({});
  });

  it("starts the shell where it last was while that directory exists", () => {
    const shellCwd = mkdtempSync(join(tmpdir(), "terminal-shell-cwd-"));
    temporaryDirs.push(shellCwd);
    const resume = { agent: "claude" as const, sessionId: "s1" };

    expect(buildTerminalRestoreInput(record({ shellCwd, resume }))).toEqual({ shellCwd, resume });
    rmSync(shellCwd, { recursive: true });
    expect(buildTerminalRestoreInput(record({ shellCwd, resume }))).toEqual({ resume });
  });
});

describe("readTerminalRecords", () => {
  it("returns saved records and deletes files that no longer parse", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-records-"));
    temporaryDirs.push(dir);
    writeTerminalRecord(dir, record());
    const brokenPath = join(dir, "broken.json");
    writeFileSync(brokenPath, "{ not json");

    expect(readTerminalRecords(dir)).toEqual([record()]);
    expect(existsSync(brokenPath)).toBe(false);
  });

  it("deletes a record filed under a name that is not its id", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-records-"));
    temporaryDirs.push(dir);
    const misplacedPath = join(dir, "copy-of-term-1.json");
    writeFileSync(misplacedPath, JSON.stringify(record()));

    expect(readTerminalRecords(dir)).toEqual([]);
    expect(existsSync(misplacedPath)).toBe(false);
  });

  it("treats a missing directory as no records", () => {
    expect(readTerminalRecords(join(tmpdir(), "terminal-records-missing-dir"))).toEqual([]);
  });
});
