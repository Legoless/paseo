import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  AgentStreamEvent,
  FetchCatalogOptions,
  ProviderCatalog,
} from "../../agent-sdk-types.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { runProviderTurn } from "../provider-runner.js";
import {
  buildBinaryDiagnosticRows,
  buildCommandResolutionDiagnosticRows,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
} from "../diagnostic-utils.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import { AntigravityStreamDecoder } from "./stream-decoder.js";
import type { AgyStreamInputMessage } from "./types.js";

const execFileAsync = promisify(execFile);

export const ANTIGRAVITY_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: false,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

function getPromptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

export function parseAgyModelsOutput(
  output: string,
  provider = "antigravity",
): AgentModelDefinition[] {
  const lines = output.split("\n");
  const models: AgentModelDefinition[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Fetching")) continue;
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
}

export class AntigravityAgentSession implements AgentSession {
  readonly provider: AgentProvider = "antigravity";
  readonly capabilities: AgentCapabilityFlags;

  private conversationId: string | null;
  private currentModeId: string;
  private currentModelId: string | null;
  private child: ChildProcess | null = null;
  private spawnPromise: Promise<ChildProcess | null> | null = null;
  private decoder: AntigravityStreamDecoder;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private activeTurnId: string | null = null;
  private isClosed = false;

  constructor(private readonly options: AntigravitySessionOptions) {
    this.capabilities = options.capabilities;
    this.conversationId = options.conversationId ?? null;
    this.currentModeId = options.config.modeId ?? "accept-edits";
    this.currentModelId = options.config.model ?? "gemini-3.8-flash-high";
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
    if (this.isClosed) return null;
    const launch = await resolveProviderLaunch({
      defaultBinary: "agy",
      commandConfig: this.options.runtimeSettings?.command,
    });
    const args = [
      ...launch.args,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
    ];

    if (this.currentModelId) {
      args.push("--model", this.currentModelId);
    }
    if (this.currentModeId === "accept-edits" || this.currentModeId === "plan") {
      args.push("--mode", this.currentModeId);
    } else if (this.currentModeId === "bypass") {
      args.push("--dangerously-skip-permissions");
    }

    if (this.conversationId) {
      args.push("--conversation", this.conversationId);
    }

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

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      this.decoder.write(chunk, this.activeTurnId ?? undefined);
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
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
        this.emit({
          type: "turn_failed",
          provider: this.provider,
          error: `Antigravity process exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          turnId: this.activeTurnId,
        });
        this.activeTurnId = null;
      }
      this.child = null;
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

    const text = getPromptText(prompt);
    const inputMessage: AgyStreamInputMessage = {
      event: "user",
      message: {
        content: [{ type: "text", text }],
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

  // biome-ignore lint/correctness/useYield: Generator required by interface contract
  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    // Process starts with clean wire state; history is managed in Paseo store
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.conversationId ?? "",
      model: this.currentModelId,
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return ANTIGRAVITY_MODES.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.description,
    }));
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentModeId;
  }

  async setMode(modeId: string): Promise<void | AgentProviderNotice> {
    this.currentModeId = modeId;
    this.emit({
      type: "mode_changed",
      provider: this.provider,
      currentModeId: modeId,
      availableModes: await this.getAvailableModes(),
    });
  }

  async setModel(modelId: string | null): Promise<void> {
    this.currentModelId = modelId;
    this.emit({
      type: "model_changed",
      provider: this.provider,
      runtimeInfo: await this.getRuntimeInfo(),
    });
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {}

  describePersistence(): AgentPersistenceHandle | null {
    if (!this.conversationId) return null;
    return {
      provider: this.provider,
      sessionId: this.conversationId,
      nativeHandle: this.conversationId,
    };
  }

  async interrupt(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGINT");
    }
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
        child?.kill("SIGTERM");
      } catch {}
    }
    if (this.child) {
      try {
        this.child.stdin?.end();
      } catch {}
      if (this.child.exitCode === null) {
        this.child.kill("SIGTERM");
      }
    }
    this.child = null;
  }

  private emit(event: AgentStreamEvent): void {
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

  constructor(options?: { logger?: Logger; runtimeSettings?: ProviderRuntimeSettings }) {
    this.logger =
      options?.logger?.child?.({ provider: "antigravity" }) ?? pino({ level: "silent" });
    this.runtimeSettings = options?.runtimeSettings;
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
      models = parseAgyModelsOutput(stdout, this.provider);
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
      ];
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
