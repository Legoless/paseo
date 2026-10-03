import { afterEach, expect, it } from "vitest";
import { isPlatform } from "../test-utils/platform.js";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hostname, tmpdir } from "node:os";
import { createWorkerTerminalManager } from "./worker-terminal-manager.js";
import { restorePersistedTerminals, writeTerminalRecord } from "./terminal-persistence.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import type {
  TerminalActivityTransitionEvent,
  TerminalManager,
  TerminalWorkspaceContributionChangedEvent,
} from "./terminal-manager.js";
import {
  resolvePaseoCliBinDir,
  resolvePaseoCliExecutablePath,
  type TerminalSession,
} from "./terminal.js";
import type { TerminalState } from "@getpaseo/protocol/messages";
import type { TerminalActivity } from "@getpaseo/protocol/terminal-activity";
import type {
  TerminalWorkerRequest,
  TerminalWorkerToParentMessage,
} from "./terminal-worker-protocol.js";

type TerminalRow = TerminalState["grid"][number];

function nodeTerminalCommand(script: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["-e", script],
  };
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function getVisibleText(session: TerminalSession): string {
  return getVisibleTextFromState(session.getState());
}

function rowToText(row: TerminalRow): string {
  return row
    .map((cell) => cell.char)
    .join("")
    .trimEnd();
}

function getVisibleTextFromState(state: TerminalState): string {
  return state.grid.map(rowToText).join("\n");
}

function getRenderedTextFromState(state: TerminalState): string {
  return [...state.scrollback, ...state.grid].map(rowToText).join("\n");
}

function readRenderedTokenIndexesFromState(state: TerminalState): number[] {
  const indexes: number[] = [];
  for (const match of getRenderedTextFromState(state).matchAll(/\[(\d+)\]/g)) {
    const value = match[1];
    if (value !== undefined) {
      indexes.push(Number(value));
    }
  }
  return indexes;
}

function createTerminalState(): TerminalState {
  const blankCell = { char: " " };
  return {
    rows: 1,
    cols: 1,
    grid: [[blankCell]],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  };
}

class FakeTerminalWorker extends EventEmitter {
  connected = true;
  killed = false;
  readonly sentMessages: TerminalWorkerRequest[] = [];

  send(message: TerminalWorkerRequest, callback: (error: Error | null) => void): boolean {
    this.sentMessages.push(message);
    callback(null);
    return true;
  }

  disconnect(): void {
    this.connected = false;
    this.emit("exit", 0, null);
  }

  kill(): boolean {
    this.killed = true;
    this.connected = false;
    this.emit("exit", 0, null);
    return true;
  }

  emitWorkerMessage(message: TerminalWorkerToParentMessage): void {
    this.emit("message", message);
  }
}

let manager: TerminalManager | null = null;
const temporaryDirs: string[] = [];
const terminalSessions: TerminalSession[] = [];

function trackTerminal(session: TerminalSession): TerminalSession {
  terminalSessions.push(session);
  return session;
}

async function removeTemporaryDir(dir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

afterEach(async () => {
  const sessions = terminalSessions.splice(0);
  await Promise.all(
    sessions.map((session) =>
      session
        .killAndWait({
          gracefulTimeoutMs: 1000,
          forceTimeoutMs: 500,
        })
        .catch(() => {}),
    ),
  );
  await manager?.killAll();
  manager = null;
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) {
      await removeTemporaryDir(dir);
    }
  }
});

function terminalRecordPath(directory: string, terminalId: string): string {
  return join(directory, `${encodeURIComponent(terminalId)}.json`);
}

async function renderedTerminalText(terminals: TerminalManager, id: string): Promise<string> {
  const snapshot = await terminals.getTerminalState(id);
  return snapshot ? getRenderedTextFromState(snapshot.state) : "";
}

it("brings a saved terminal back with its id, title and scrollback after a restart", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-restore-"));
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(cwd, recordsDirectory);
  const previousDaemon = createWorkerTerminalManager({ recordsDirectory });
  const session = await previousDaemon.createTerminal({
    workspaceId: "ws-test",
    cwd,
    persist: true,
    ...nodeTerminalCommand(
      'process.stdout.write("restore-marker\\r\\n"); setInterval(() => {}, 1000);',
    ),
  });
  await waitForCondition(
    async () => (await renderedTerminalText(previousDaemon, session.id)).includes("restore-marker"),
    10000,
  );
  previousDaemon.setTerminalTitle(session.id, "My build");
  await previousDaemon.killAll();

  expect(
    JSON.parse(readFileSync(terminalRecordPath(recordsDirectory, session.id), "utf8")),
  ).toMatchObject({
    id: session.id,
    workspaceId: "ws-test",
    title: "My build",
    scrollback: expect.stringContaining("restore-marker"),
  });

  manager = createWorkerTerminalManager({ recordsDirectory });
  await restorePersistedTerminals({
    directory: recordsDirectory,
    terminalManager: manager,
    activeWorkspaceIds: new Set(["ws-test"]),
    logger: createTestLogger(),
  });
  const restored = manager.getTerminal(session.id);
  expect(restored).toBeDefined();
  trackTerminal(restored!);
  expect(restored!.getTitle()).toBe("My build");
  const restoredManager = manager;
  await waitForCondition(async () => {
    const text = await renderedTerminalText(restoredManager, session.id);
    return text.includes("restore-marker") && text.includes("Session restored");
  }, 10000);
});

it("brings a terminal back in the directory its shell last reported", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "worker-terminal-manager-shell-cwd-")));
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(cwd, recordsDirectory);
  const moved = join(cwd, "moved-shell-dir");
  mkdirSync(moved);
  const previousDaemon = createWorkerTerminalManager({ recordsDirectory });
  // What zsh's integration prints once `cd moved-shell-dir` ends: the directory, then the command's end.
  const prompt = `\x1b]7;file://${hostname()}${pathToFileURL(moved).pathname}\x07\x1b]633;D;0\x07`;
  const session = await previousDaemon.createTerminal({
    workspaceId: "ws-test",
    cwd,
    persist: true,
    ...nodeTerminalCommand(
      `process.stdin.once("data", () => process.stdout.write(${JSON.stringify(prompt)})); setInterval(() => {}, 1000);`,
    ),
  });
  const readRecord = () =>
    JSON.parse(readFileSync(terminalRecordPath(recordsDirectory, session.id), "utf8"));
  expect(readRecord()).toMatchObject({ cwd, shellCwd: cwd });

  // Saved when the command ends, so a crash or power loss keeps it too.
  session.send({ type: "input", data: "x\r" });
  await waitForCondition(() => readRecord().shellCwd === moved, 10000);
  await previousDaemon.killAll();
  const saved = readRecord();
  expect(saved).toMatchObject({ cwd, shellCwd: moved });

  manager = createWorkerTerminalManager({ recordsDirectory });
  await restorePersistedTerminals({
    directory: recordsDirectory,
    terminalManager: manager,
    activeWorkspaceIds: new Set(["ws-test"]),
    logger: createTestLogger(),
  });
  const restored = manager.getTerminal(session.id);
  expect(restored).toBeDefined();
  trackTerminal(restored!);
  // Still filed under its own cwd, so the workspace keeps listing it.
  expect(restored!.cwd).toBe(cwd);
  // Saved again on create by the restored terminal, which reports the directory it started in.
  const resaved = readRecord();
  expect(resaved.savedAt).not.toBe(saved.savedAt);
  expect(resaved).toMatchObject({ cwd, shellCwd: moved });
});

it("drops saved terminals whose workspace is gone", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-restore-gone-"));
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(cwd, recordsDirectory);
  const previousDaemon = createWorkerTerminalManager({ recordsDirectory });
  const session = await previousDaemon.createTerminal({
    workspaceId: "ws-archived",
    cwd,
    persist: true,
    ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
  });
  await previousDaemon.killAll();

  manager = createWorkerTerminalManager({ recordsDirectory });
  await restorePersistedTerminals({
    directory: recordsDirectory,
    terminalManager: manager,
    activeWorkspaceIds: new Set(["ws-test"]),
    logger: createTestLogger(),
  });

  expect(manager.getTerminal(session.id)).toBeUndefined();
  expect(existsSync(terminalRecordPath(recordsDirectory, session.id))).toBe(false);
});

it("keeps a restored agent's resume record while its shell initializes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-resume-"));
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(cwd, recordsDirectory);
  const resume = { agent: "claude" as const, sessionId: "sess-restored" };
  const terminalId = "term-restored-agent";
  const promptGate = join(cwd, "prompt-ready");
  writeTerminalRecord(recordsDirectory, {
    version: 1,
    id: terminalId,
    workspaceId: "ws-test",
    cwd,
    name: "Terminal 1",
    rows: 24,
    cols: 200,
    savedAt: new Date().toISOString(),
    resume,
  });
  manager = createWorkerTerminalManager({ recordsDirectory });
  const terminals = manager;
  // A real child holds its first prompt until the test releases it, so create's 50 ms delay
  // cannot conceal the interval where the restore command has been typed but no prompt appeared.
  const command = nodeTerminalCommand(`
    const fs = require("node:fs");
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk.toString(); });
    process.stdout.write("waiting-for-prompt\\r\\n");
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(promptGate)}) || !input.includes("sess-restored")) return;
      clearInterval(timer);
      process.stdout.write("\\x1b]633;A\\x07Claude Code v2.1.284\\r\\nresume:" + input);
    }, 10);
    setInterval(() => {}, 1000);
  `);
  await restorePersistedTerminals({
    directory: recordsDirectory,
    terminalManager: {
      ...terminals,
      createTerminal: (options) => terminals.createTerminal({ ...options, ...command }),
    },
    activeWorkspaceIds: new Set(["ws-test"]),
    logger: createTestLogger(),
  });
  const session = terminals.getTerminal(terminalId);
  expect(session?.id).toBe(terminalId);
  trackTerminal(session!);
  const readRecord = () =>
    JSON.parse(readFileSync(terminalRecordPath(recordsDirectory, terminalId), "utf8"));
  await waitForCondition(
    async () => (await renderedTerminalText(terminals, terminalId)).includes("waiting-for-prompt"),
    10000,
  );
  expect(readRecord().resume).toEqual(resume);

  // Metadata saves during startup must preserve the same target too.
  terminals.setTerminalTitle(terminalId, "Restored agent");
  await waitForCondition(() => readRecord().title === "Restored agent", 10000);
  expect(readRecord().resume).toEqual(resume);

  writeFileSync(promptGate, "ready");
  await waitForCondition(
    async () =>
      (await renderedTerminalText(terminals, terminalId)).includes(
        "resume: claude --resume sess-restored",
      ),
    10000,
  );
  await terminals.setTerminalActivity(terminalId, "working", undefined, resume.sessionId);
  expect(readRecord().resume).toEqual(resume);
  await terminals.killAll();
  expect(readRecord().resume).toEqual(resume);
});

it("keeps a saved terminal only while it can still come back", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-records-"));
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(cwd, recordsDirectory);
  manager = createWorkerTerminalManager({ recordsDirectory });
  const terminals = manager;
  const idle = nodeTerminalCommand("setInterval(() => {}, 1000);");
  const closed = await terminals.createTerminal({
    workspaceId: "ws-test",
    cwd,
    persist: true,
    ...idle,
  });
  const exited = await terminals.createTerminal({
    workspaceId: "ws-test",
    cwd,
    persist: true,
    ...nodeTerminalCommand('process.stdin.on("data", () => process.exit(0));'),
  });
  const signalled = await terminals.createTerminal({
    workspaceId: "ws-test",
    cwd,
    persist: true,
    ...nodeTerminalCommand('process.stdin.on("data", () => process.kill(process.pid, "SIGTERM"));'),
  });
  const unsaved = trackTerminal(
    await terminals.createTerminal({ workspaceId: "ws-test", cwd, ...idle }),
  );
  const recordOf = (id: string) => terminalRecordPath(recordsDirectory, id);

  expect(existsSync(recordOf(closed.id))).toBe(true);
  expect(existsSync(recordOf(unsaved.id))).toBe(false);

  terminals.setTerminalWorkspaceId(closed.id, "ws-moved");
  await waitForCondition(
    () => readFileSync(recordOf(closed.id), "utf8").includes("ws-moved"),
    5000,
  );

  await terminals.killTerminalAndWait(closed.id);
  expect(existsSync(recordOf(closed.id))).toBe(false);

  exited.send({ type: "input", data: "x\r" });
  await waitForCondition(() => !existsSync(recordOf(exited.id)), 10000);

  // A signal Paseo did not send may be a reboot: the record waits for shutdown, then goes.
  signalled.send({ type: "input", data: "x\r" });
  await waitForCondition(() => terminals.getTerminal(signalled.id) === undefined, 10000);
  // ConPTY reports only an exit code, so Windows deletes immediately rather than entering grace.
  expect(existsSync(recordOf(signalled.id))).toBe(signalled.getExitInfo()!.signal !== null);
  await waitForCondition(() => !existsSync(recordOf(signalled.id)), 10000);
});

it("keeps saved terminals when the worker cannot restore them", async () => {
  const recordsDirectory = mkdtempSync(join(tmpdir(), "worker-terminal-records-"));
  temporaryDirs.push(recordsDirectory);
  writeTerminalRecord(recordsDirectory, {
    version: 1,
    id: "term-kept",
    workspaceId: "ws-test",
    cwd: recordsDirectory,
    name: "Terminal 1",
    rows: 24,
    cols: 80,
    savedAt: new Date().toISOString(),
  });
  const worker = new FakeTerminalWorker();
  worker.connected = false;
  manager = createWorkerTerminalManager({ forkWorker: () => worker });

  await restorePersistedTerminals({
    directory: recordsDirectory,
    terminalManager: manager,
    activeWorkspaceIds: new Set(["ws-test"]),
    logger: createTestLogger(),
  });

  expect(existsSync(terminalRecordPath(recordsDirectory, "term-kept"))).toBe(true);
});

it("creates a terminal through the worker and streams output", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-output-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdin.on("data", (chunk) => {
        process.stdout.write("worker-output:" + chunk.toString());
      });
      setInterval(() => {}, 1000);
    `),
    }),
  );
  const messages: string[] = [];
  let snapshots = 0;
  const unsubscribe = session.subscribe((message) => {
    if (message.type === "output") {
      messages.push(message.data);
    }
    if (message.type === "snapshot") {
      snapshots += 1;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const snapshotsBeforeOutput = snapshots;

  session.send({ type: "input", data: "hello\r" });

  await waitForCondition(
    () =>
      messages.join("").includes("worker-output:hello") ||
      getVisibleText(session).includes("worker-output:hello"),
    10000,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  unsubscribe();

  expect(messages.join("") + getVisibleText(session)).toContain("worker-output:hello");
  expect(snapshots).toBe(snapshotsBeforeOutput);
});

it("delivers rapid small writes complete and in order through worker coalescing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-coalesce-"));
  temporaryDirs.push(cwd);
  const burstGatePath = join(cwd, "burst-ready");
  manager = createWorkerTerminalManager();
  // The file gate starts the burst after this test subscribes without depending
  // on platform-specific PTY input echo/canonical-mode behavior.
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      env: { PASEO_TERMINAL_BURST_GATE: burstGatePath },
      ...nodeTerminalCommand(`
      const fs = require("node:fs");
      const gatePath = process.env.PASEO_TERMINAL_BURST_GATE;
      const gate = setInterval(() => {
        if (!gatePath || !fs.existsSync(gatePath)) {
          return;
        }
        clearInterval(gate);
        for (let i = 0; i < 500; i++) {
          process.stdout.write("[" + i + "]\\n");
        }
      }, 10);
      setInterval(() => {}, 1000);
    `),
    }),
  );

  const events: Array<{ type: string; data?: string }> = [];
  session.subscribe((message) => {
    if (message.type === "output") {
      events.push({ type: "output", data: message.data });
    } else if (message.type === "snapshot" || message.type === "snapshotReady") {
      events.push({ type: message.type });
    }
  });

  // Let the snapshot subscription settle, then trigger the burst.
  await new Promise((resolve) => setTimeout(resolve, 100));
  writeFileSync(burstGatePath, "go");

  const expected = Array.from({ length: 500 }, (_, index) => index);
  let received: number[] = [];
  await waitForCondition(async () => {
    const snapshot = await manager!.getTerminalState(session.id);
    received = snapshot ? readRenderedTokenIndexesFromState(snapshot.state) : [];
    return expected.every((value, index) => received[index] === value);
  }, 10000);

  expect(received).toEqual(expected);

  await waitForCondition(() => events.some((event) => event.type === "output"), 10000);

  // No snapshot may land after output it should have preceded: every snapshot
  // event must come before the first output event.
  const firstOutputIndex = events.findIndex((event) => event.type === "output");
  expect(firstOutputIndex).toBeGreaterThanOrEqual(0);
  const snapshotAfterOutput = events
    .slice(firstOutputIndex + 1)
    .find((event) => event.type === "snapshot" || event.type === "snapshotReady");
  expect(snapshotAfterOutput).toBeUndefined();
});

it("pulls fresh terminal state from the worker authority", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-state-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdout.write("worker-state-ready\\n");
      setInterval(() => {}, 1000);
    `),
    }),
  );

  let visibleText = "";
  await waitForCondition(async () => {
    const snapshot = await manager!.getTerminalState(session.id);
    visibleText = snapshot ? getVisibleTextFromState(snapshot.state) : "";
    return visibleText.includes("worker-state-ready");
  }, 10000);

  expect(visibleText).toContain("worker-state-ready");
});

// Windows ConPTY normalizes away the kitty keyboard escape the child writes, so it
// never reaches the worker's input-mode tracker and the preamble stays empty. The
// preamble-caching contract is verified on Linux/macOS; the daemon's input-mode
// handling runs identically on every platform once the escape is observed.
it.skipIf(isPlatform("win32"))(
  "caches the input-mode replay preamble from the worker after getTerminalState",
  async () => {
    const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-preamble-"));
    temporaryDirs.push(cwd);
    manager = createWorkerTerminalManager();
    // \x1b[>1u pushes kitty keyboard flag 1, which the worker's input-mode
    // tracker records and reflects in its replay preamble (\x1b[=1;1u).
    const session = trackTerminal(
      await manager.createTerminal({
        workspaceId: "ws-test",
        cwd,
        ...nodeTerminalCommand(`
      process.stdout.write("\\u001b[>1u");
      setInterval(() => {}, 1000);
    `),
      }),
    );

    await waitForCondition(async () => {
      const snapshot = await manager!.getTerminalState(session.id);
      return snapshot !== null && session.getReplayPreamble() === "\x1b[=1;1u";
    }, 10000);

    expect(session.getReplayPreamble()).toBe("\x1b[=1;1u");
  },
);

it("refreshes cached terminal title after worker title changes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-title-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdout.write("\\u001b]0;Build Output\\u0007");
      setTimeout(() => {}, 2000);
    `),
    }),
  );

  await waitForCondition(() => session.getTitle() === "Build Output", 10000);

  expect(session.getState().title).toBe("Build Output");
});

it("keeps a renamed terminal's title when the shell emits a later OSC title", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-rename-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  // Every tick writes an OSC 0 title followed by a [n] marker, so a marker
  // arriving is proof the title before it was parsed. The interval outruns the
  // 150ms title debounce.
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      let index = 0;
      setInterval(() => {
        index += 1;
        process.stdout.write("\\u001b]0;Shell " + index + "\\u0007[" + index + "]");
      }, 400);
    `),
    }),
  );

  const output: string[] = [];
  session.subscribe((message) => {
    if (message.type === "output") {
      output.push(message.data);
    }
  });
  const lastMarker = (): number => {
    const matches = [...output.join("").matchAll(/\[(\d+)\]/g)];
    const last = matches.at(-1)?.[1];
    return last === undefined ? 0 : Number(last);
  };

  await waitForCondition(() => session.getTitle()?.startsWith("Shell ") === true, 10000);

  expect(manager.setTerminalTitle(session.id, "My Terminal")).toBe(true);
  await waitForCondition(() => session.getTitle() === "My Terminal", 10000);

  const markerAtRename = lastMarker();
  await waitForCondition(() => lastMarker() >= markerAtRename + 3, 10000);

  expect(session.getTitle()).toBe("My Terminal");
  expect(session.getState().title).toBe("My Terminal");
});

it("refreshes cached terminal size after worker resize", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-resize-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(await manager.createTerminal({ cwd, workspaceId: "ws-test" }));

  session.send({ type: "resize", rows: 10, cols: 40 });
  const snapshot = await manager.getTerminalState(session.id);

  expect(snapshot?.state.rows).toBe(10);
  expect(snapshot?.state.cols).toBe(40);
  expect(session.getState().rows).toBe(10);
  expect(session.getState().cols).toBe(40);
});

it("captures terminal output from the worker authority", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-capture-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(await manager.createTerminal({ cwd, workspaceId: "ws-test" }));

  session.send({ type: "input", data: "echo hello world\r" });

  let capture = await manager.captureTerminal(session.id);
  await waitForCondition(async () => {
    capture = await manager!.captureTerminal(session.id);
    return capture.lines.join("\n").includes("hello world");
  }, 10000);

  expect(capture.lines.join("\n")).toContain("hello world");
  expect(capture.totalLines).toBeGreaterThan(0);
});

it("does not surface fire-and-forget send timeouts as unhandled rejections", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-1",
      name: "Terminal",
      cwd: "/tmp",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });
  const session = manager.getTerminal("terminal-1");
  expect(session).toBeDefined();

  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    session?.send({ type: "input", data: "x" });
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }

  expect(worker.sentMessages.some((message) => message.type === "send")).toBe(true);
  expect(unhandledRejections).toEqual([]);
});

it("re-parents a terminal across workspaces in the parent-side mirror", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({ forkWorker: () => worker });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-1",
      name: "Terminal",
      cwd: "/tmp",
      workspaceId: "ws-owned",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });
  const terminalsChanged: string[] = [];
  const unsubscribe = manager.subscribeTerminalsChanged((event) => {
    terminalsChanged.push(event.cwd);
  });

  expect(manager.setTerminalWorkspaceId("terminal-1", "ws-sibling")).toBe(true);
  expect(manager.setTerminalWorkspaceId("terminal-missing", "ws-sibling")).toBe(false);

  expect(manager.getTerminal("terminal-1")?.workspaceId).toBe("ws-sibling");
  const scoped = await manager.getTerminals("/tmp", { workspaceId: "ws-sibling" });
  expect(scoped.map((terminal) => terminal.id)).toEqual(["terminal-1"]);
  expect(await manager.getTerminals("/tmp", { workspaceId: "ws-owned" })).toEqual([]);
  expect(terminalsChanged).toEqual(["/tmp"]);
  unsubscribe();
});

it("keeps registered cwd env inheritance behind the worker manager interface", async () => {
  manager = createWorkerTerminalManager();
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-env-"));
  temporaryDirs.push(cwd);
  const markerPath = join(cwd, "env.txt");

  manager.registerCwdEnv({
    cwd,
    env: { PASEO_WORKER_TERMINAL_TEST: "worker-env" },
  });
  trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      require("node:fs").writeFileSync(
        ${JSON.stringify(markerPath)},
        process.env.PASEO_WORKER_TERMINAL_TEST ?? "",
      );
      setInterval(() => {}, 1000);
    `),
    }),
  );

  await waitForCondition(() => existsSync(markerPath), 10000);

  expect(readFileSync(markerPath, "utf8")).toBe("worker-env");
});

it("injects parent-minted terminal activity env through the worker", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-activity-env-"));
  temporaryDirs.push(cwd);
  const envPath = join(cwd, "activity-env.json");
  const activityUrl = "http://127.0.0.1:12345/api/terminal-activity";
  manager = createWorkerTerminalManager({
    getTerminalActivityUrl: () => activityUrl,
  });

  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
        require("node:fs").writeFileSync(
          ${JSON.stringify(envPath)},
          JSON.stringify({
            terminalId: process.env.PASEO_TERMINAL_ID,
            token: process.env.PASEO_ACTIVITY_TOKEN,
            url: process.env.PASEO_TERMINAL_ACTIVITY_URL,
            hookCli: process.env.PASEO_HOOK_CLI,
            path: process.env.PATH ?? process.env.Path,
          }),
        );
        setInterval(() => {}, 1000);
      `),
    }),
  );

  await waitForCondition(() => existsSync(envPath), 10000);

  const env = JSON.parse(readFileSync(envPath, "utf8")) as {
    terminalId?: string;
    token?: string;
    url?: string;
    hookCli?: string;
    path?: string;
  };
  const paseoCliBinDir = resolvePaseoCliBinDir();
  const paseoCliPath = resolvePaseoCliExecutablePath();
  expect(paseoCliBinDir).not.toBeNull();
  expect(paseoCliPath).not.toBeNull();
  expect(env.terminalId).toBe(session.id);
  expect(env.token).toEqual(expect.any(String));
  expect(env.token).not.toBe("");
  expect(env.url).toBe(activityUrl);
  expect(env.hookCli).toBe(paseoCliPath);
  expect(manager.validateTerminalActivityToken(session.id, env.token ?? "")).toBe("valid");
  await expect(manager.setTerminalActivity(session.id, "attention")).resolves.toBe(true);
  expect(env.path?.split(delimiter)[0]).toBe(paseoCliBinDir);
});

it("runs onCreateTerminal before asking the worker for the terminal", async () => {
  const worker = new FakeTerminalWorker();
  const createRequestsSentBeforeHook: number[] = [];
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
    onCreateTerminal: () => {
      createRequestsSentBeforeHook.push(
        worker.sentMessages.filter((message) => message.type === "createTerminal").length,
      );
    },
  });

  await expect(manager.createTerminal({ cwd: "/tmp", workspaceId: "ws-test" })).rejects.toThrow();

  expect(createRequestsSentBeforeHook).toEqual([0]);
  expect(worker.sentMessages.some((message) => message.type === "createTerminal")).toBe(true);
});

it("starts the default shell through the worker and accepts quoted commands", async () => {
  manager = createWorkerTerminalManager();
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-shell-"));
  temporaryDirs.push(cwd);
  const markerPath = join(cwd, "shell quoted marker.txt");
  const session = trackTerminal(await manager.createTerminal({ cwd, workspaceId: "ws-test" }));
  const command = [
    "node",
    "-e",
    `"require('node:fs').writeFileSync('shell quoted marker.txt','shell-ok')"`,
  ].join(" ");

  session.send({ type: "input", data: `${command}\r` });

  await waitForCondition(() => existsSync(markerPath), 10000);

  expect(readFileSync(markerPath, "utf8")).toBe("shell-ok");
});

it("lists subdirectory terminals when querying the workspace root", async () => {
  const rootCwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-subdir-root-"));
  const subdirCwd = join(rootCwd, "apps", "mobile");
  mkdirSync(subdirCwd, { recursive: true });
  temporaryDirs.push(rootCwd);
  manager = createWorkerTerminalManager();
  const created = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd: subdirCwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  const rootTerminals = await manager.getTerminals(rootCwd);

  expect(rootTerminals.map((terminal) => terminal.id)).toEqual([created.id]);
});

it("lists terminals locally without waiting on the worker", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-root",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-subdir",
      name: "Shell",
      cwd: "/workspace/apps/mobile",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });

  // The fake worker never answers requests, so a round-trip would reject at the
  // 5ms timeout. A local mirror read must resolve regardless.
  const terminals = await manager.getTerminals("/workspace");

  expect(terminals.map((terminal) => terminal.id).sort()).toEqual([
    "terminal-root",
    "terminal-subdir",
  ]);
  expect(worker.sentMessages.some((message) => message.type === "getTerminals")).toBe(false);
});

it("includes only stamped terminals in workspace-scoped local reads", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-legacy",
      name: "Legacy",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-owned",
      name: "Owned",
      cwd: "/workspace",
      workspaceId: "ws-owned",
      activity: null,
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-sibling",
      name: "Sibling",
      cwd: "/workspace",
      workspaceId: "ws-sibling",
      activity: null,
    },
    state: createTerminalState(),
  });

  const scoped = await manager.getTerminals("/workspace", { workspaceId: "ws-owned" });
  const unscoped = await manager.getTerminals("/workspace");

  expect(scoped.map((terminal) => terminal.id)).toEqual(["terminal-owned"]);
  expect(unscoped.map((terminal) => terminal.id)).toEqual([
    "terminal-legacy",
    "terminal-owned",
    "terminal-sibling",
  ]);
});

it("rejects non-absolute cwd in getTerminals", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  await expect(manager.getTerminals("relative/path")).rejects.toThrow("cwd must be absolute path");
});

it("surfaces worker activity changes via getActivity, onActivityChange, and terminalsChanged", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });

  const session = manager.getTerminal("terminal-a");
  expect(session).toBeDefined();
  expect(session!.getActivity()).toEqual({ state: "idle", changedAt: 0 });

  const activityChanges: Array<{
    activity: TerminalActivity | null;
    previous: TerminalActivity | null;
  }> = [];
  const activityTransitions: TerminalActivityTransitionEvent[] = [];
  const terminalsChangedCwds: string[] = [];
  session!.onActivityChange((transition) => {
    activityChanges.push(transition);
  });
  manager.subscribeTerminalActivity((event) => {
    activityTransitions.push(event);
  });
  manager.subscribeTerminalsChanged((event) => {
    terminalsChangedCwds.push(event.cwd);
  });

  const workingActivity = { state: "working" as const, changedAt: 1000 };
  const idleActivity = { state: "idle" as const, changedAt: 0 };
  worker.emitWorkerMessage({
    type: "terminalActivityChange",
    terminalId: "terminal-a",
    activity: workingActivity,
    previous: idleActivity,
  });

  expect(session!.getActivity()).toEqual(workingActivity);
  expect(activityChanges).toEqual([{ activity: workingActivity, previous: idleActivity }]);
  expect(activityTransitions).toEqual([
    {
      terminalId: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: workingActivity,
      previous: idleActivity,
    },
  ]);
  expect(terminalsChangedCwds).toContain("/workspace");
});

it("sets terminal activity through a worker request", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const result = manager.setTerminalActivity("terminal-a", "attention", "quota", "session-a");
  const request = worker.sentMessages.find((message) => message.type === "setActivity");
  expect(request).toMatchObject({
    type: "setActivity",
    terminalId: "terminal-a",
    state: "attention",
    attentionReason: "quota",
    sessionId: "session-a",
  });
  if (!request) {
    throw new Error("setActivity request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  await expect(result).resolves.toBe(true);
});

it("clears terminal attention through a worker request", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", attentionReason: "finished", changedAt: 1000 },
    },
    state: createTerminalState(),
  });

  const result = manager.clearTerminalAttention("terminal-a");
  const request = worker.sentMessages.find((message) => message.type === "clearAttention");
  expect(request).toMatchObject({
    type: "clearAttention",
    terminalId: "terminal-a",
  });
  if (!request) {
    throw new Error("attention clear request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  await expect(result).resolves.toBe(true);
});

it("clears finished attention on a real terminal", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-attention-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  // A working -> idle transition is how the real tracker records a "finished"
  // attention: { state: "idle", attentionReason: "finished" }. The state is
  // never literally "attention", so a clear that checks state === "attention"
  // would never fire — the bug this reproduces.
  await manager.setTerminalActivity(session.id, "working");
  await manager.setTerminalActivity(session.id, "idle");
  await waitForCondition(
    () => manager?.getTerminal(session.id)?.getActivity()?.attentionReason === "finished",
    5000,
  );

  const cleared = await manager.clearTerminalAttention(session.id);

  expect(cleared).toBe(true);
  await waitForCondition(
    () => manager?.getTerminal(session.id)?.getActivity()?.attentionReason == null,
    5000,
  );
  expect(manager.getTerminal(session.id)?.getActivity()).toEqual({
    state: "idle",
    changedAt: expect.any(Number),
  });
});

it("removes worker terminals after killAndWait", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-kill-"));
  temporaryDirs.push(cwd);
  manager = createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  await manager.killTerminalAndWait(session.id, {
    gracefulTimeoutMs: 1000,
    forceTimeoutMs: 500,
  });
  terminalSessions.splice(terminalSessions.indexOf(session), 1);

  await waitForCondition(() => manager?.getTerminal(session.id) === undefined, 5000);

  expect(manager.getTerminal(session.id)).toBeUndefined();
  expect(manager.listDirectories()).not.toContain(cwd);
});

it("produces one terminals-changed snapshot per title change", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((t) => t.id) });
  });

  worker.emitWorkerMessage({
    type: "terminalTitleChange",
    terminalId: "terminal-a",
    title: "Updated",
  });

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toEqual({
    cwd: "/workspace",
    terminalIds: ["terminal-a"],
  });
});

it("produces one terminals-changed snapshot and one contribution event per activity change", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((t) => t.id) });
  });
  const contributions: TerminalWorkspaceContributionChangedEvent[] = [];
  manager.subscribeTerminalWorkspaceContributionChanged((event) => {
    contributions.push(event);
  });

  const workingActivity = { state: "working" as const, changedAt: 1000 };
  worker.emitWorkerMessage({
    type: "terminalActivityChange",
    terminalId: "terminal-a",
    activity: workingActivity,
    previous: null,
  });

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toEqual({
    cwd: "/workspace",
    terminalIds: ["terminal-a"],
  });
  expect(contributions).toEqual([
    {
      terminalId: "terminal-a",
      cwd: "/workspace",
      workspaceId: "ws-test",
    },
  ]);
});

it("removes a killed worker terminal from terminalExit without duplicate snapshots", async () => {
  const worker = new FakeTerminalWorker();
  manager = createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  const workingActivity = { state: "working" as const, changedAt: 1000 };

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: workingActivity,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((terminal) => terminal.id) });
  });
  const contributions: TerminalWorkspaceContributionChangedEvent[] = [];
  manager.subscribeTerminalWorkspaceContributionChanged((event) => {
    contributions.push(event);
  });

  manager.killTerminal("terminal-a");
  const request = worker.sentMessages.find(
    (message) => message.type === "killTerminal" && message.terminalId === "terminal-a",
  );
  if (!request) {
    throw new Error("killTerminal request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  worker.emitWorkerMessage({
    type: "terminalExit",
    terminalId: "terminal-a",
    info: {
      exitCode: null,
      signal: null,
      lastOutputLines: [],
    },
  });

  expect(manager.getTerminal("terminal-a")).toBeUndefined();
  expect(snapshots).toEqual([{ cwd: "/workspace", terminalIds: [] }]);
  expect(contributions).toEqual([
    {
      terminalId: "terminal-a",
      cwd: "/workspace",
      workspaceId: "ws-test",
    },
  ]);
});
