import { statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

export interface McpWait {
  servers: string[];
  elapsed: string;
}

export interface McpWaitWatcher {
  // Ignores lines already in the log, so an earlier wait is not reported again.
  skipWritten(): void;
  stop(): void;
}

const POLL_MS = 2_000;
const MAX_READ_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
// agy writes this to its log every 30s while it holds a session for MCP servers that have
// not connected yet (plugin servers with eager tools hold it for up to five minutes). Nothing
// reaches stream-json stdout during that wait.
const MCP_WAIT_LINE = /\bMCP: \d+ server\(s\) still connecting after (\S+): (.+)$/;

export function parseMcpWait(line: string): McpWait | null {
  const match = MCP_WAIT_LINE.exec(line.trimEnd());
  if (!match) return null;
  const servers = match[2]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return servers.length > 0 ? { elapsed: match[1], servers } : null;
}

// Follows the agy log file from its start and reports each MCP wait line. The file appears
// only after agy starts, so a missing file is retried on the next tick. agy writes its log
// unbuffered, so a line's byte position orders it against skipWritten().
export function watchMcpWaits(file: string, onWait: (wait: McpWait) => void): McpWaitWatcher {
  let handle: FileHandle | null = null;
  let offset = 0;
  let pending = Buffer.alloc(0);
  let pendingStart = 0;
  let floor = 0;
  let reading = false;
  let stopped = false;

  async function readAppended(): Promise<void> {
    if (!handle) {
      try {
        handle = await open(file, "r");
      } catch {
        return;
      }
    }
    if (stopped) return;
    const { size } = await handle.stat();
    if (size <= offset) return;
    const buffer = Buffer.alloc(Math.min(size - offset, MAX_READ_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    offset += bytesRead;
    const chunk = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
    let cursor = 0;
    for (let newline = chunk.indexOf(NEWLINE); newline !== -1; ) {
      const lineStart = pendingStart + cursor;
      const line = chunk.toString("utf8", cursor, newline);
      cursor = newline + 1;
      newline = chunk.indexOf(NEWLINE, cursor);
      if (stopped || lineStart < floor) continue;
      const wait = parseMcpWait(line);
      if (wait) onWait(wait);
    }
    pending = chunk.subarray(cursor);
    pendingStart += cursor;
  }

  function closeHandle(): void {
    const current = handle;
    handle = null;
    void current?.close().catch(() => undefined);
  }

  const timer = setInterval(() => {
    if (reading || stopped) return;
    reading = true;
    void readAppended()
      .catch(() => undefined)
      .finally(() => {
        reading = false;
        if (stopped) closeHandle();
      });
  }, POLL_MS);
  timer.unref();

  return {
    skipWritten() {
      try {
        floor = Math.max(floor, statSync(file).size);
      } catch {
        // agy has not created the log yet, so nothing was written before this point.
      }
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      if (!reading) closeHandle();
    },
  };
}
