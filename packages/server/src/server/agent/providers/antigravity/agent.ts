import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pino, { type Logger } from "pino";

import { ANTIGRAVITY_MODES } from "@getpaseo/protocol/provider-manifest";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPromptInput,
  AgentProvider,
  AgentProviderNotice,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  AgentStreamEvent,
  FetchCatalogOptions,
  ImportableProviderSession,
  ImportProviderSessionContext,
  ImportProviderSessionInput,
  ListImportableSessionsOptions,
  ProviderCatalog,
} from "../../agent-sdk-types.js";
import { importSessionFromPersistence } from "../../provider-session-import.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "../provider-runner.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
} from "../diagnostic-utils.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import { applyAgyWorkspaceMcpOverlay, type AgyMcpOverlay } from "./mcp.js";
import {
  ANTIGRAVITY_EFFORT_OPTIONS,
  normalizeAntigravityEffort,
  readAntigravityProviderOptions,
  type AntigravityEffort,
  type AntigravityProviderOptions,
} from "./options.js";
import { buildAgyUserPrompt } from "./prompt.js";
import { listAgyImportableSessions, resolveAgyTranscriptPath } from "./sessions.js";
import { AntigravityStreamDecoder } from "./stream-decoder.js";
import { streamAgyTranscriptHistory } from "./transcript.js";
import type { AgyStreamInputMessage } from "./types.js";

const execFileAsync = promisify(execFile);
const PROCESS_EXIT_GRACE_MS = 5_000;

export const ANTIGRAVITY_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

export function withAgyEffortOptions(model: AgentModelDefinition): AgentModelDefinition {
  return {
    ...model,
    thinkingOptions: ANTIGRAVITY_EFFORT_OPTIONS,
  };
}

export function buildAgySpawnArgs(input: {
  launchArgs: string[];
  modelId: string | null;
  modeId: string;
  conversationId: string | null;
  effort: AntigravityEffort | null;
  sandbox: boolean;
  agent: string | null;
  addDir: string[];
}): string[] {
  const args = [
    ...input.launchArgs,
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
  ];
  if (input.modelId) args.push("--model", input.modelId);
  if (input.modeId === "accept-edits" || input.modeId === "plan") {
    args.push("--mode", input.modeId);
  } else if (input.modeId === "bypass") {
    args.push("--dangerously-skip-permissions");
  }
  if (input.effort) args.push("--effort", input.effort);
  if (input.sandbox) args.push("--sandbox");
  if (input.agent) args.push("--agent", input.agent);
  for (const dir of input.addDir) {
    args.push("--add-dir", dir);
  }
  if (input.conversationId) args.push("--conversation", input.conversationId);
  return args;
}

const ESC = String.fromCharCode(0x1b);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

export function parseAgyModelsOutput(
  output: string,
  provider = "antigravity",
): AgentModelDefinition[] {
  // Strip ANSI escape sequences
  const cleanOutput = output.replace(ANSI_PATTERN, "");
  const lines = cleanOutput.split(/[\r\n]+/);
  const models: AgentModelDefinition[] = [];
  for (const rawLine of lines) {
    const line = rawLine.includes("\r") ? rawLine.split("\r").pop()! : rawLine;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Fetching") || /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(trimmed)) continue;
    const parts = line.split("\t");
    let id = "";
    let label = "";
    if (parts.length >= 2) {
      id = parts[0].trim();
      label = parts[1].trim();
    } else {
      const match = trimmed.match(/^([a-z0-9.-]+)\s+(.+)$/);
      if (match) {
        id = match[1];
        label = match[2];
      }
    }
    if (id && label && /^[a-z0-9.-]+$/.test(id)) {
      models.push({
        provider,
        id,
        label,
        isDefault: id === "gemini-3.8-flash-high",
      });
    }
  }
  return models;
}

interface AntigravitySessionOptions {
  config: AgentSessionConfig;
  conversationId?: string;
  capabilities: AgentCapabilityFlags;
  runtimeSettings?: ProviderRuntimeSettings;
  launchContext?: AgentLaunchContext;
  logger: Logger;
  homeDir?: string;
}

export class AntigravityAgentSession implements AgentSession {
  readonly provider: AgentProvider = "antigravity";
  readonly capabilities: AgentCapabilityFlags;

  private conversationId: string | null;
  private currentModeId: string;
  private currentModelId: string | null;
  private currentEffort: AntigravityEffort | null;
  private readonly providerOptions: AntigravityProviderOptions;
  private child: ChildProcess | null = null;
  private spawnPromise: Promise<ChildProcess | null> | null = null;
  private decoder: AntigravityStreamDecoder;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private readonly pendingPermissions = new Map<string, AgentPermissionRequest>();
  private readonly mcpOverlay: AgyMcpOverlay | null;
  private imageDir: string | null = null;
  private activeTurnId: string | null = null;
  private isClosed = false;
  // A process being replaced; the next one resumes the same conversation once it has exited.
  private exitingChild: Promise<void> | null = null;

  constructor(private readonly options: AntigravitySessionOptions) {
    this.capabilities = options.capabilities;
    this.conversationId = options.conversationId ?? null;
    this.currentModeId = options.config.modeId ?? "accept-edits";
    this.currentModelId = options.config.model ?? "gemini-3.8-flash-high";
    this.providerOptions = readAntigravityProviderOptions(options.config.providerOptions);
    this.currentEffort =
      normalizeAntigravityEffort(options.config.thinkingOptionId) ??
      this.providerOptions.effort ??
      null;
    this.mcpOverlay = options.config.mcpServers
      ? applyAgyWorkspaceMcpOverlay(options.config.cwd, options.config.mcpServers)
      : null;
    this.decoder = new AntigravityStreamDecoder(
      this.provider,
      (event) => this.emit(event),
      (id) => {
        this.conversationId = id;
      },
    );
    void this.ensureProcess();
  }

  get id(): string | null {
    return this.conversationId;
  }

  private async ensureProcess(): Promise<ChildProcess | null> {
    if (this.child && this.child.exitCode === null) {
      return this.child;
    }
    if (!this.spawnPromise) {
      this.spawnPromise = this.spawnProcess().finally(() => {
        this.spawnPromise = null;
      });
    }
    return this.spawnPromise;
  }

  private async spawnProcess(): Promise<ChildProcess | null> {
    await this.exitingChild;
    if (this.isClosed) return null;
    const launch = await resolveProviderLaunch({
      defaultBinary: "agy",
      commandConfig: this.options.runtimeSettings?.command,
    });
    const args = buildAgySpawnArgs({
      launchArgs: launch.args,
      modelId: this.currentModelId,
      modeId: this.currentModeId,
      conversationId: this.conversationId,
      effort: this.currentEffort,
      sandbox: this.providerOptions.sandbox === true,
      agent: this.providerOptions.agent ?? null,
      addDir: this.providerOptions.addDir ?? [],
    });

    const child = spawnProcess(launch.command, args, {
      cwd: this.options.config.cwd,
      env: {
        ...process.env,
        AGY_CLI_DISABLE_AUTO_UPDATE: "1",
        ...this.options.runtimeSettings?.env,
        ...this.options.launchContext?.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (this.isClosed) {
      child.kill("SIGTERM");
      return null;
    }

    this.child = child;

    let stderrBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.decoder.write(chunk, this.activeTurnId ?? undefined);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      this.options.logger.debug({ chunk }, "Antigravity stderr output");
    });

    child.on("error", (error) => {
      this.options.logger.error({ error }, "Antigravity child process error");
      if (this.activeTurnId) {
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          error: error.message,
          turnId: this.activeTurnId,
        });
        this.activeTurnId = null;
      }
    });

    child.on("close", (code, signal) => {
      this.decoder.flush(this.activeTurnId ?? undefined);
      if (this.activeTurnId && code !== 0 && !this.isClosed) {
        const errorMsg =
          stderrBuffer.trim() ||
          `Antigravity process exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          error: errorMsg,
          turnId: this.activeTurnId,
        });
        this.activeTurnId = null;
      }
      if (this.child === child) {
        this.child = null;
      }
    });

    return child;
  }

  async run(prompt: AgentPromptInput, runOptions?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions,
      startTurn: (p, opt) => this.startTurn(p, opt),
      subscribe: (cb) => this.subscribe(cb),
      getSessionId: () => this.id || "",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.isClosed) {
      throw new Error("Cannot start turn on closed Antigravity session");
    }
    if (!this.child || this.child.exitCode !== null) {
      await this.ensureProcess();
    }
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.decoder.resetTurn();
    this.emit({ type: "turn_started", provider: this.provider, turnId });

    const prepared = buildAgyUserPrompt(
      prompt,
      Array.isArray(prompt) && prompt.some((block) => block.type === "image")
        ? this.ensureImageDir()
        : undefined,
    );
    const inputMessage: AgyStreamInputMessage = {
      event: "user",
      message: {
        content: prepared.text,
      },
    };

    if (!this.child?.stdin?.writable) {
      throw new Error("Antigravity process stdin is not writable");
    }
    this.child.stdin.write(JSON.stringify(inputMessage) + "\n");
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    if (!this.conversationId) return;
    yield* streamAgyTranscriptHistory(
      this.provider,
      resolveAgyTranscriptPath(this.conversationId, this.options.homeDir),
    );
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.conversationId ?? "",
      model: this.currentModelId,
      thinkingOptionId: this.currentEffort,
      modeId: this.currentModeId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return ANTIGRAVITY_MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
    }));
  }

  private terminateCurrentProcess(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.child) return;
    const oldChild = this.child;
    this.child = null;
    oldChild.removeAllListeners();
    oldChild.stdout?.removeAllListeners();
    oldChild.stderr?.removeAllListeners();
    try {
      oldChild.stdin?.end();
    } catch {}
    if (oldChild.exitCode === null) {
      const exited = new Promise<void>((resolve) => oldChild.once("exit", () => resolve()));
      const forceKill = setTimeout(() => oldChild.kill("SIGKILL"), PROCESS_EXIT_GRACE_MS);
      this.exitingChild = exited.then(() => clearTimeout(forceKill));
      oldChild.kill(signal);
    }
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId;
  }

  async setMode(modeId: string): Promise<void | AgentProviderNotice> {
    if (this.currentModeId !== modeId) {
      this.currentModeId = modeId;
      if (!this.activeTurnId) {
        this.terminateCurrentProcess();
      }
    }
    this.emit({
      type: "mode_changed",
      provider: this.provider,
      currentModeId: modeId,
      availableModes: await this.getAvailableModes(),
    });
  }

  async setModel(modelId: string | null): Promise<void> {
    if (this.currentModelId !== modelId) {
      this.currentModelId = modelId;
      if (!this.activeTurnId) {
        this.terminateCurrentProcess();
      }
    }
    this.emit({
      type: "model_changed",
      provider: this.provider,
      runtimeInfo: await this.getRuntimeInfo(),
    });
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void | AgentProviderNotice> {
    const effort = normalizeAntigravityEffort(thinkingOptionId);
    if (thinkingOptionId !== null && effort === null) {
      throw new Error(`Antigravity thinking option '${thinkingOptionId}' is not available`);
    }
    if (this.currentEffort !== effort) {
      this.currentEffort = effort;
      if (!this.activeTurnId) {
        this.terminateCurrentProcess();
      }
    }
    this.emit({
      type: "thinking_option_changed",
      provider: this.provider,
      thinkingOptionId: effort,
    });
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingPermissions.values()];
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending Antigravity permission request with id '${requestId}'`);
    }
    this.pendingPermissions.delete(requestId);
    if (response.behavior === "allow") {
      await this.setMode("bypass");
    }
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
      turnId: this.activeTurnId ?? undefined,
    });
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (!this.conversationId) return null;
    return {
      provider: this.provider,
      sessionId: this.conversationId,
      nativeHandle: this.conversationId,
    };
  }

  async interrupt(): Promise<void> {
    // agy aborts the turn on SIGINT, reports it as an "interrupted" ERROR result, and exits.
    // Detach it first: that result must not land on the next turn, which resumes the
    // conversation in a fresh process.
    this.terminateCurrentProcess("SIGINT");
    if (this.activeTurnId) {
      this.emit({
        type: "turn_canceled",
        provider: this.provider,
        reason: "Interrupted by user",
        turnId: this.activeTurnId,
      });
      this.activeTurnId = null;
    }
  }

  async close(): Promise<void> {
    this.isClosed = true;
    if (this.spawnPromise) {
      try {
        const child = await this.spawnPromise;
        if (child) {
          child.removeAllListeners();
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.kill("SIGTERM");
        }
      } catch {}
    }
    this.terminateCurrentProcess();
    this.mcpOverlay?.restore();
    if (this.imageDir) {
      rmSync(this.imageDir, { recursive: true, force: true });
      this.imageDir = null;
    }
  }

  private ensureImageDir(): string {
    if (!this.imageDir) {
      this.imageDir = mkdtempSync(join(tmpdir(), "paseo-agy-images-"));
    }
    return this.imageDir;
  }

  private emit(event: AgentStreamEvent): void {
    if (event.type === "permission_requested") {
      this.pendingPermissions.set(event.request.id, event.request);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.options.logger.error({ err }, "Listener error handling Antigravity stream event");
      }
    }
    if (
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled"
    ) {
      if (this.activeTurnId && "turnId" in event && event.turnId === this.activeTurnId) {
        this.activeTurnId = null;
      }
    }
  }
}

export class AntigravityAgentClient implements AgentClient {
  readonly provider: AgentProvider = "antigravity";
  readonly capabilities: AgentCapabilityFlags = ANTIGRAVITY_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly homeDir?: string;

  constructor(options?: {
    logger?: Logger;
    runtimeSettings?: ProviderRuntimeSettings;
    homeDir?: string;
  }) {
    this.logger =
      options?.logger?.child?.({ provider: "antigravity" }) ?? pino({ level: "silent" });
    this.runtimeSettings = options?.runtimeSettings;
    this.homeDir = options?.homeDir;
  }

  async listCommands(_config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const launch = await resolveProviderLaunch({
        defaultBinary: "agy",
        commandConfig: this.runtimeSettings?.command,
      });
      const check = await checkProviderLaunchAvailable(launch);
      return check.available;
    } catch {
      return false;
    }
  }

  async fetchCatalog(_options: FetchCatalogOptions): Promise<ProviderCatalog> {
    let models: AgentModelDefinition[] = [];

    try {
      const launch = await resolveProviderLaunch({
        defaultBinary: "agy",
        commandConfig: this.runtimeSettings?.command,
      });
      const { stdout } = await execFileAsync(launch.command, [...launch.args, "models"], {
        env: {
          ...process.env,
          AGY_CLI_DISABLE_AUTO_UPDATE: "1",
          ...this.runtimeSettings?.env,
        },
        timeout: 10_000,
      });
      models = parseAgyModelsOutput(stdout, this.provider).map(withAgyEffortOptions);
    } catch (error) {
      this.logger.warn(
        { error },
        "Failed to query models from agy CLI; falling back to default model list",
      );
    }

    if (models.length === 0) {
      models = [
        {
          provider: this.provider,
          id: "gemini-3.8-flash-high",
          label: "Gemini 3.8 Flash (High)",
          isDefault: true,
        },
        {
          provider: this.provider,
          id: "gemini-3.8-flash-medium",
          label: "Gemini 3.8 Flash (Medium)",
        },
        {
          provider: this.provider,
          id: "gemini-3.7-flash-high",
          label: "Gemini 3.7 Flash (High)",
        },
        {
          provider: this.provider,
          id: "gemini-3.1-pro-high",
          label: "Gemini 3.1 Pro (High)",
        },
        {
          provider: this.provider,
          id: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6 (Thinking)",
        },
        {
          provider: this.provider,
          id: "gpt-oss-120b-medium",
          label: "GPT-OSS 120B (Medium)",
        },
      ].map(withAgyEffortOptions);
    }

    return {
      models,
      modes: ANTIGRAVITY_MODES.map((mode) => ({
        id: mode.id,
        label: mode.label,
        description: mode.description,
      })),
      defaultModeId: "accept-edits",
    };
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new AntigravityAgentSession({
      config,
      capabilities: this.capabilities,
      runtimeSettings: this.runtimeSettings,
      launchContext,
      logger: this.logger,
      homeDir: this.homeDir,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const config: AgentSessionConfig = {
      provider: this.provider,
      cwd: overrides?.cwd ?? process.cwd(),
      model: overrides?.model,
      modeId: overrides?.modeId,
      ...overrides,
    };

    return new AntigravityAgentSession({
      config,
      conversationId: handle.nativeHandle,
      capabilities: this.capabilities,
      runtimeSettings: this.runtimeSettings,
      launchContext,
      logger: this.logger,
      homeDir: this.homeDir,
    });
  }

  async listImportableSessions(
    options?: ListImportableSessionsOptions,
  ): Promise<ImportableProviderSession[]> {
    return listAgyImportableSessions({ ...options, homeDir: this.homeDir });
  }

  async importSession(input: ImportProviderSessionInput, context: ImportProviderSessionContext) {
    return importSessionFromPersistence({
      provider: this.provider,
      request: input,
      context,
      resumeSession: this.resumeSession.bind(this),
    });
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await resolveProviderLaunch({
        defaultBinary: "agy",
        commandConfig: this.runtimeSettings?.command,
      });
      const availability = await checkProviderLaunchAvailable(launch);
      let version = "unknown";
      if (availability.available) {
        try {
          const { stdout } = await execFileAsync(launch.command, [...launch.args, "--version"], {
            timeout: 5_000,
          });
          version = stdout.trim();
        } catch {}
      }

      const diagnostic = formatProviderDiagnostic("Antigravity", [
        ...(await buildCommandResolutionDiagnosticRows(launch, { knownBinaryNames: ["agy"] })),
        ...(await buildBinaryDiagnosticRows(launch, availability)),
        { label: "Version", value: version },
      ]);
      return { diagnostic };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError("Antigravity", error),
      };
    }
  }
}
