import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createRealpathAwarePathMatcher } from "../../../../utils/path.js";
import type {
  ImportableProviderSession,
  ListImportableSessionsOptions,
} from "../../agent-sdk-types.js";

const HISTORY_FILE_NAME = "history.jsonl";
const DEFAULT_LIMIT = 20;
const MAX_SCAN = 500;
const HISTORY_READ_CAP_BYTES = 2 * 1024 * 1024;

export interface AgyHistoryEntry {
  display?: string;
  timestamp?: number;
  workspace?: string;
  conversationId?: string;
}

export function resolveAgyCliHome(homeDir = homedir()): string {
  return join(homeDir, ".gemini", "antigravity-cli");
}

export function resolveAgyTranscriptPath(conversationId: string, homeDir = homedir()): string {
  return join(
    resolveAgyCliHome(homeDir),
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
}

export async function listAgyImportableSessions(
  options: ListImportableSessionsOptions & { homeDir?: string } = {},
): Promise<ImportableProviderSession[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const scanLimit = Math.min(options.scanLimit ?? MAX_SCAN, MAX_SCAN);
  const matchesCwd = options.cwd ? createRealpathAwarePathMatcher(options.cwd) : null;
  const query = options.query?.trim().toLowerCase() ?? "";
  const historyPath = join(resolveAgyCliHome(options.homeDir), HISTORY_FILE_NAME);
  const entries = await readAgyHistoryEntries(historyPath);
  const latestById = new Map<string, ImportableProviderSession>();

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const session = toImportableSession(entries[index]);
    if (!session) continue;
    if (matchesCwd && !matchesCwd(session.cwd)) continue;
    if (query.length > 0 && !matchesQuery(session, query)) continue;
    if (!latestById.has(session.providerHandleId)) {
      latestById.set(session.providerHandleId, session);
    }
    if (latestById.size >= scanLimit) break;
  }

  return [...latestById.values()]
    .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
    .slice(0, limit);
}

async function readAgyHistoryEntries(path: string): Promise<AgyHistoryEntry[]> {
  let contents: string;
  try {
    const handle = await open(path, "r");
    try {
      const stats = await handle.stat();
      if (stats.size <= HISTORY_READ_CAP_BYTES) {
        contents = await handle.readFile("utf8");
      } else {
        const start = Math.max(0, stats.size - HISTORY_READ_CAP_BYTES);
        const buffer = Buffer.alloc(stats.size - start);
        await handle.read(buffer, 0, buffer.length, start);
        contents = buffer.toString("utf8");
        const firstNewline = contents.indexOf("\n");
        if (firstNewline !== -1) contents = contents.slice(firstNewline + 1);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const entries: AgyHistoryEntry[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      entries.push(JSON.parse(trimmed) as AgyHistoryEntry);
    } catch {
      // Skip malformed history lines.
    }
  }
  return entries;
}

function toImportableSession(entry: AgyHistoryEntry): ImportableProviderSession | null {
  if (typeof entry.conversationId !== "string" || entry.conversationId.length === 0) return null;
  if (typeof entry.workspace !== "string" || entry.workspace.length === 0) return null;
  const display = typeof entry.display === "string" ? entry.display : null;
  const timestamp = typeof entry.timestamp === "number" ? new Date(entry.timestamp) : new Date(0);
  return {
    providerHandleId: entry.conversationId,
    cwd: entry.workspace,
    title: display,
    firstPromptPreview: display,
    lastPromptPreview: display,
    lastActivityAt: timestamp,
  };
}

function matchesQuery(session: ImportableProviderSession, query: string): boolean {
  const haystacks = [
    session.title,
    session.firstPromptPreview,
    session.lastPromptPreview,
    session.cwd,
  ];
  return haystacks.some((value) => value !== null && value.toLowerCase().includes(query));
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
