import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import { claudeQuery, type ClaudeQueryFactory } from "./query.js";

export const CLAUDE_DISABLED_THINKING_OPTION_ID = "off";
export const CLAUDE_ULTRACODE_THINKING_OPTION_ID = "ultracode";
export const CLAUDE_ULTRACODE_FLAG_MIN_VERSION: readonly [number, number, number] = [2, 1, 284];

/** Host facts discovered with a catalog; every session reads them from its model. */
export interface ClaudeCatalogFacts {
  claudeCodeVersion?: string | null;
  /** `ultracode` from the user's Claude settings.json, which applies when Paseo sends none. */
  settingsUltracode?: boolean;
}

export function claudeCodeVersionAtLeast(
  version: string | null | undefined,
  min: readonly [number, number, number],
): boolean {
  const parsed = version ? parseClaudeCodeVersion(version) : null;
  if (!parsed) return false;
  for (let i = 0; i < 3; i += 1) {
    if (parsed[i] > min[i]) return true;
    if (parsed[i] < min[i]) return false;
  }
  return true;
}

export function mapClaudeModels(
  models: readonly ModelInfo[],
  facts?: ClaudeCatalogFacts,
): AgentModelDefinition[] {
  const isFlag = claudeCodeVersionAtLeast(
    facts?.claudeCodeVersion,
    CLAUDE_ULTRACODE_FLAG_MIN_VERSION,
  );
  return models.map((model) => {
    if (
      typeof model.value !== "string" ||
      !model.value.trim() ||
      typeof model.displayName !== "string"
    )
      throw new Error("Claude returned an invalid model definition");
    const definition: AgentModelDefinition = {
      provider: "claude",
      id: model.value,
      label: model.displayName,
      description: model.description,
      metadata: {
        claude: model,
        unsupportedModeIds: model.supportsAutoMode === true ? [] : ["auto"],
        claudeCodeVersion: facts?.claudeCodeVersion ?? null,
        settingsUltracode: facts?.settingsUltracode === true,
      },
      ...(model.value === "default" ? { isDefault: true } : {}),
      ...(model.resolvedModel && model.resolvedModel !== model.value
        ? { aliases: [model.resolvedModel] }
        : {}),
    };
    if (model.supportedEffortLevels && model.supportsEffort !== false) {
      definition.thinkingOptions = model.supportedEffortLevels.map((id) => ({
        id,
        label: id === "xhigh" ? "Extra High" : id.charAt(0).toUpperCase() + id.slice(1),
      }));
      if (!isFlag && model.supportedEffortLevels.includes("xhigh")) {
        definition.thinkingOptions.push({
          id: CLAUDE_ULTRACODE_THINKING_OPTION_ID,
          label: "Ultra Code",
        });
      }
    } else if (model.supportsEffort === false) {
      definition.thinkingOptions = [];
    }
    return definition;
  });
}

export function findClaudeModel(
  models: readonly AgentModelDefinition[],
  modelId: string | null | undefined,
): AgentModelDefinition | undefined {
  if (!modelId) return models.find((model) => model.isDefault);
  return (
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.aliases?.includes(modelId))
  );
}

export function claudeModelCapability(
  model: AgentModelDefinition | undefined,
  capability: "supportsAdaptiveThinking" | "supportsFastMode" | "supportsAutoMode",
): boolean {
  const native = model?.metadata?.claude;
  return isRecord(native) && native[capability] === true;
}

export function resolveConfiguredClaudeModel(model: AgentModelDefinition): AgentModelDefinition {
  return model;
}

export async function discoverClaudeModels(input: {
  cwd: string;
  resolveBinary: () => Promise<string>;
  runtimeSettings?: ProviderRuntimeSettings;
  configDir?: string;
  queryFactory?: ClaudeQueryFactory;
  signal?: AbortSignal;
}): Promise<ModelInfo[]> {
  input.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  let child: ChildProcess | undefined;
  let probe: ReturnType<typeof claudeQuery> | undefined;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => {});
  const onAbort = () =>
    rejectAbort?.(controller.signal.reason ?? new Error("Claude model discovery aborted"));
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const binary = await input.resolveBinary();
    input.signal?.throwIfAborted();
    probe = claudeQuery(
      {
        prompt: (async function* empty() {})(),
        options: {
          cwd: input.cwd,
          sessionId: randomUUID(),
          persistSession: false,
          // Claude only honors no-session-persistence with an explicit print flag.
          extraArgs: { print: null },
          pathToClaudeCodeExecutable: binary,
          permissionMode: "plan",
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: ["user", "project", "local"],
          settings: { disableAllHooks: true },
          abortController: controller,
        },
      },
      {
        runtimeSettings: input.runtimeSettings,
        ...(input.configDir ? { launchEnv: { CLAUDE_CONFIG_DIR: input.configDir } } : {}),
        queryFactory: input.queryFactory,
        onChildProcess: (spawnedChild) => {
          child = spawnedChild;
        },
      },
    );
    return await withTimeout(
      Promise.race([probe.supportedModels(), aborted]),
      10_000,
      "Claude model discovery timed out",
    );
  } finally {
    input.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
    try {
      probe?.close();
    } finally {
      controller.abort();
      if (child)
        await terminateWithTreeKill(child, { gracefulTimeoutMs: 500, forceTimeoutMs: 500 });
    }
  }
}

export async function getClaudeModelsWithSettings(
  logger: Logger,
  configDir: string | undefined,
  nativeModels: readonly ModelInfo[],
  options?: { claudeCodeVersion?: string | null },
): Promise<AgentModelDefinition[]> {
  const settings = await readClaudeSettings(logger, configDir);
  const models = mapClaudeModels(nativeModels, {
    claudeCodeVersion: options?.claudeCodeVersion,
    settingsUltracode: settings?.ultracode === true,
  });
  for (const model of claudeSettingsModels(settings)) {
    if (!findClaudeModel(models, model.id)) models.push(model);
  }
  return models;
}

async function readClaudeSettings(
  logger: Logger,
  configDir?: string,
): Promise<Record<string, unknown> | null> {
  const settingsPath = path.join(
    configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
    "settings.json",
  );
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings");
    return null;
  }
}

function claudeSettingsModels(parsed: Record<string, unknown> | null): AgentModelDefinition[] {
  if (!parsed) return [];
  const models: AgentModelDefinition[] = [];
  addSettingsModel(models, parsed.model, "model");
  if (isRecord(parsed.env)) {
    for (const [key, value] of Object.entries(parsed.env)) {
      if (
        key === "ANTHROPIC_MODEL" ||
        key === "ANTHROPIC_SMALL_FAST_MODEL" ||
        (key.startsWith("ANTHROPIC_DEFAULT_") && key.endsWith("_MODEL"))
      ) {
        addSettingsModel(models, value, `env.${key}`);
      }
    }
  }
  return models;
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || models.some((model) => model.id === id)) return;
  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseClaudeCodeVersion(value: string): [number, number, number] | null {
  const match =
    value.match(/\b(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/i) ??
    value.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Runtime model IDs are opaque; only the native catalog supplies aliases. */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function resolveObservedClaudeModelId(value: string | null | undefined): string | null {
  const id = normalizeClaudeRuntimeModelId(value);
  return id === "<synthetic>" ? null : id;
}
