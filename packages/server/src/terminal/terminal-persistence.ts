import { accessSync, constants, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { TerminalState } from "@getpaseo/protocol/messages";
import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
import { writePrivateFileAtomicSync } from "../server/private-files.js";
import type { TerminalManager } from "./terminal-manager.js";

// A terminal the user opened comes back after the daemon or the machine restarts, the way cmux and
// Orca bring panes back: same id, the shell's last directory, a fresh login shell, and either the old
// scrollback or the agent's own resume command. The old process is never re-run from its argv.

export const TERMINAL_RECORDS_DIRNAME = "terminals";

// cmux caps a restored pane at 400,000 characters. The headless buffer already holds at most
// 1,000 scrollback rows, so this only bites on very wide, heavily styled output.
const MAX_SCROLLBACK_CHARS = 400_000;

// Hook payloads are trusted only as far as the loopback token; the id is typed into a shell, so it
// may not start with `-` and pass itself off as a flag.
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const TerminalResumeTargetSchema = z.object({
  agent: z.enum(["claude", "codex"]),
  sessionId: z.string().regex(SESSION_ID_PATTERN),
});

export type TerminalResumeTarget = z.infer<typeof TerminalResumeTargetSchema>;

const TerminalRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  cwd: z.string().min(1),
  // Where the shell last reported being (OSC 7). The terminal stays filed under `cwd`.
  shellCwd: z.string().min(1).optional(),
  name: z.string(),
  // Only a title the user typed. A shell-derived title regenerates at the first prompt.
  title: z.string().optional(),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  savedAt: z.string(),
  resume: TerminalResumeTargetSchema.optional(),
  // ANSI, plain panes only: a resumed agent redraws its own transcript.
  scrollback: z.string().optional(),
});

export type TerminalRecord = z.infer<typeof TerminalRecordSchema>;

/** What a restored terminal starts with, besides its saved id, cwd, name, title and size. */
export interface TerminalRestoreInput {
  /** Where the shell starts, in place of the terminal's cwd. */
  shellCwd?: string;
  /** Written into the terminal before the shell starts, so it sits above the first prompt. */
  seed?: string;
  /** Typed into the new shell once, and kept as the terminal's resume target. */
  resume?: TerminalResumeTarget;
}

export function toTerminalResumeTarget(
  agent: string | null,
  sessionId: string,
): TerminalResumeTarget | null {
  const parsed = TerminalResumeTargetSchema.safeParse({ agent, sessionId });
  return parsed.success ? parsed.data : null;
}

export function buildTerminalResumeInput(target: TerminalResumeTarget): string {
  // The leading space keeps the line out of shell history, as cmux does.
  return target.agent === "claude"
    ? ` claude --resume ${target.sessionId}\r`
    : ` codex resume ${target.sessionId}\r`;
}

export function renderRestoreScrollback(state: TerminalState): string {
  // Rows below the cursor are blank viewport; restored, they would push the prompt down.
  const rowCount = state.cursor.row + 1;
  const rendered = renderTerminalSnapshotToAnsi({
    ...state,
    grid: state.grid.slice(0, rowCount),
    ...(state.gridWrapped ? { gridWrapped: state.gridWrapped.slice(0, rowCount) } : {}),
  });
  // Drop the cursor placement the renderer appends after its final reset: it addresses the old
  // viewport, and the restored shell draws its own prompt below the seed.
  const RESET = "\u001b[0m";
  let body = `${rendered.slice(0, rendered.lastIndexOf(RESET) + RESET.length)}\u001b[?7h`;
  if (body.length > MAX_SCROLLBACK_CHARS) {
    // Every rendered row resets its own style, so a row boundary is a safe cut.
    const cut = body.indexOf("\r\n", body.length - MAX_SCROLLBACK_CHARS);
    body = cut === -1 ? "" : body.slice(cut + 2);
  }
  return body;
}

export function buildTerminalRestoreInput(record: TerminalRecord): TerminalRestoreInput {
  // A directory removed since, or one only another user could enter (a `sudo -s` shell), falls
  // back to the terminal's cwd: the pty cannot start in it, and the exit would drop the record.
  const start =
    record.shellCwd && isEnterableDirectory(record.shellCwd) ? { shellCwd: record.shellCwd } : {};
  if (record.resume) {
    return { ...start, resume: record.resume };
  }
  if (!record.scrollback) {
    return start;
  }
  const restoredAt = new Date(record.savedAt).toLocaleString();
  return {
    ...start,
    seed: `${record.scrollback}\r\n\u001b[2m── Session restored from ${restoredAt} ──\u001b[0m\r\n`,
  };
}

function recordPath(directory: string, terminalId: string): string {
  return path.join(directory, `${encodeURIComponent(terminalId)}.json`);
}

export function writeTerminalRecord(directory: string, record: TerminalRecord): void {
  writePrivateFileAtomicSync(recordPath(directory, record.id), JSON.stringify(record));
}

export function deleteTerminalRecord(directory: string, terminalId: string): void {
  rmSync(recordPath(directory, terminalId), { force: true });
}

/** Reads every record, deleting any file that no longer parses. */
export function readTerminalRecords(directory: string): TerminalRecord[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const records: TerminalRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) {
      continue;
    }
    const filePath = path.join(directory, name);
    try {
      const record = TerminalRecordSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      // A file that is not where its id says it lives would never be deleted by that id.
      if (recordPath(directory, record.id) !== filePath) {
        throw new Error("Terminal record file does not match its id");
      }
      records.push(record);
    } catch {
      rmSync(filePath, { force: true });
    }
  }
  return records;
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isEnterableDirectory(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
  } catch {
    return false;
  }
  return isDirectory(candidate);
}

/**
 * Brings back every saved terminal whose workspace is still active and whose cwd still exists.
 * Runs before the daemon accepts clients, so the first terminal list already has the old ids and
 * the app keeps their tabs instead of pruning them.
 */
export async function restorePersistedTerminals(input: {
  directory: string;
  terminalManager: TerminalManager;
  activeWorkspaceIds: ReadonlySet<string>;
  logger: Logger;
}): Promise<void> {
  const { directory, terminalManager, activeWorkspaceIds, logger } = input;
  for (const record of readTerminalRecords(directory)) {
    if (!activeWorkspaceIds.has(record.workspaceId) || !isDirectory(record.cwd)) {
      try {
        deleteTerminalRecord(directory, record.id);
      } catch (error) {
        logger.warn({ err: error, terminalId: record.id }, "Failed to delete terminal record");
      }
      continue;
    }
    try {
      await terminalManager.createTerminal({
        id: record.id,
        cwd: record.cwd,
        workspaceId: record.workspaceId,
        name: record.name,
        ...(record.title ? { title: record.title } : {}),
        rows: record.rows,
        cols: record.cols,
        persist: true,
        restore: buildTerminalRestoreInput(record),
      });
    } catch (error) {
      // Kept: a worker that failed to start fails every create, and must not cost every record.
      logger.warn({ err: error, terminalId: record.id }, "Failed to restore terminal");
    }
  }
}
