import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnProcess } from "@getpaseo/plugin/server";
import { signalProcess } from "./signals.js";
import { createInterface } from "node:readline";
import type { ProviderLaunch, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";
import { agyCliHome } from "./home.js";
import { watchMcpWaits, type McpWait } from "./mcp-wait.js";
import {
  AntigravityError,
  decodeFrame,
  diagnostic,
  encodePrompt,
  type Frame,
  type Init,
} from "./wire.js";

interface DriverOptions {
  launch: ProviderLaunch;
  config: ProviderSessionConfig;
  model?: string;
  conversationId: string | null;
  onFrame(frame: Frame): void;
  onMcpWait(wait: McpWait): void;
  onExit(error: AntigravityError): void;
}

export interface Driver {
  ready: Promise<Init>;
  selection: string;
  // Call before prompting a driver that is already running, so waits it logged earlier stay
  // with the earlier turn or startup.
  skipWrittenMcpWaits(): void;
  prompt(text: string): Promise<void>;
  stop(reason: "interrupt" | "close"): Promise<void>;
}

export function selection(config: ProviderSessionConfig): string {
  return JSON.stringify([config.model, config.mode, config.thinkingOption]);
}

function driverArgs(options: DriverOptions, logFile: string | null): string[] {
  const { config, conversationId } = options;
  const args = [
    ...options.launch.args,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--add-dir",
    config.cwd,
    "--disable-slash-commands",
    "--dangerously-skip-permissions",
  ];
  if (logFile) args.push("--log-file", logFile);
  if (options.model) args.push("--model", options.model);
  if (conversationId) args.push("--conversation", conversationId);
  return args;
}

// agy reports MCP connection waits only in its log, so each driver owns a named log file next
// to agy's own instead of sharing the newest cli-<time>.log with every other agy process.
function driverLogFile(options: DriverOptions): string | null {
  const directory = path.join(agyCliHome(options.config, options.launch), "log");
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return null;
  }
  return path.join(directory, `cli-${logStamp(new Date())}-paseo-${randomUUID().slice(0, 8)}.log`);
}

function logStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${day}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function startDriver(options: DriverOptions): Driver {
  const logFile = driverLogFile(options);
  const child = spawnProcess(options.launch.command, driverArgs(options, logFile), {
    cwd: options.config.cwd,
    env: { AGY_CLI_DISABLE_AUTO_UPDATE: "1", ...options.launch.env, ...options.config.env },
    detached: process.platform !== "win32",
    stdio: "pipe",
  });
  const lines = createInterface({ input: child.stdout });
  let cleanup = Promise.resolve();
  let stderr = "";
  let state: "starting" | "ready" | "stopping" | "exited" = "starting";
  let resolveReady: (init: Init) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<Init>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const mcpWaits = logFile
    ? watchMcpWaits(logFile, (wait) => {
        if (state === "starting" || state === "ready") options.onMcpWait(wait);
      })
    : null;
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  child.stdin.on("error", (error: Error) =>
    fail(new AntigravityError(error.message, "STDIN_ERROR")),
  );
  child.on("error", (error: Error) => {
    mcpWaits?.stop();
    fail(new AntigravityError(error.message, "SPAWN_ERROR"));
  });
  child.on("close", (code, signal) => {
    lines.close();
    mcpWaits?.stop();
    const error = new AntigravityError(
      diagnostic(stderr.trim() || `Antigravity exited (${signal || code})`),
      "PROCESS_EXIT",
    );
    if (state === "starting") rejectReady(error);
    if (state === "ready") options.onExit(error);
    state = "exited";
    resolveExit();
  });
  lines.on("line", (line) => {
    if (!line.trim() || state === "exited" || state === "stopping") return;
    let decoded: Frame;
    try {
      decoded = decodeFrame(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(new AntigravityError(`Invalid Antigravity output: ${message}`, "INVALID_FRAME"));
      return;
    }
    if (state === "starting") {
      if (decoded.event === "init") {
        state = "ready";
        resolveReady(decoded);
      } else if (decoded.event === "result") {
        fail(new AntigravityError(diagnostic(decoded.result.error), "STARTUP_ERROR"));
      }
      return;
    }
    options.onFrame(decoded);
  });

  function fail(failure: AntigravityError): void {
    if (state === "starting") rejectReady(failure);
    if (state === "ready") options.onExit(failure);
    if (state === "exited" || state === "stopping") return;
    state = "stopping";
    cleanup = Promise.resolve(signalGroup(child, "SIGKILL"));
    // The stop operation awaits cleanup and owns reporting its failure.
    void cleanup.catch(() => undefined);
  }

  return {
    ready,
    selection: selection(options.config),
    skipWrittenMcpWaits() {
      mcpWaits?.skipWritten();
    },
    prompt(text) {
      if (state !== "ready")
        return Promise.reject(new AntigravityError("Antigravity is not ready"));
      return new Promise<void>((resolve, reject) => {
        child.stdin.write(encodePrompt(text), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
    async stop(reason) {
      if (process.platform === "win32") await cleanup;
      if (state === "exited") return;
      if (state === "starting") rejectReady(new AntigravityError("Antigravity startup canceled"));
      state = "stopping";
      if (process.platform === "win32") {
        // Node signal emulation kills only the leader; taskkill must see the live tree.
        cleanup = Promise.resolve(signalGroup(child, "SIGKILL"));
        await cleanup;
        await exited;
        return;
      }
      if (reason === "close") child.stdin.end();
      else signalGroup(child, "SIGINT");
      const terminate = setTimeout(() => signalGroup(child, "SIGTERM"), 1000);
      const kill = setTimeout(() => signalGroup(child, "SIGKILL"), 2000);
      await exited;
      clearTimeout(terminate);
      clearTimeout(kill);
      // A tool can keep running after its CLI leader exits.
      signalGroup(child, "SIGKILL");
    },
  };
}

function signalGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void | Promise<void> {
  if (!child.pid) return;
  return signalProcess({ platform: process.platform, pid: child.pid, signal });
}

interface ProbeOptions {
  launch: ProviderLaunch;
  args: string[];
  cwd?: string;
}
export function probe(options: ProbeOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(options.launch.command, [...options.launch.args, ...options.args], {
      env: { AGY_CLI_DISABLE_AUTO_UPDATE: "1", ...options.launch.env },
      cwd: options.cwd,
      stdio: "pipe",
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const deadline = setTimeout(() => {
      const termination = Promise.resolve(signalGroup(child, "SIGKILL"));
      void termination.then(() => {
        reject(new AntigravityError("Antigravity discovery timed out", "PROBE_TIMEOUT"));
        return undefined;
      }, reject);
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.on("error", (error: Error) => {
      clearTimeout(deadline);
      reject(new AntigravityError(error.message, "SPAWN_ERROR"));
    });
    child.on("close", (code, signal) => {
      clearTimeout(deadline);
      if (code === 0) resolve(stdout);
      else
        reject(
          new AntigravityError(
            diagnostic(stderr.trim() || `agy exited with ${signal || `code ${code}`}`),
            "PROBE_ERROR",
          ),
        );
    });
  });
}
