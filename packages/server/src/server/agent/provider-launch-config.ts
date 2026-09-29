import { isAbsolute } from "node:path";
import {
  executableExists,
  findExecutable,
} from "../../executable-resolution/executable-resolution.js";
import { createExternalProcessEnv, type ProcessEnvRecord } from "../paseo-env.js";
export {
  AgentProviderRuntimeSettingsMapSchema,
  ProviderCommandSchema,
  ProviderOverrideSchema,
  ProviderOverridesSchema,
  ProviderProfileModelSchema,
  ProviderRuntimeSettingsSchema,
  type AgentProviderRuntimeSettingsMap,
  type ProviderCommand,
  type ProviderOverride,
  type ProviderOverrides,
  type ProviderProfileModel,
  type ProviderRuntimeSettings,
} from "@getpaseo/protocol/provider-config";
import {
  ProviderOverrideSchema,
  ProviderOverridesSchema,
  ProviderRuntimeSettingsSchema,
  type ProviderCommand,
  type ProviderOverride,
  type ProviderOverrides,
  type ProviderRuntimeSettings,
} from "@getpaseo/protocol/provider-config";

export interface ProviderCommandPrefix {
  command: string;
  args: string[];
}

export type ProviderLaunchSource = "default" | "append" | "override";

export interface ResolvedProviderLaunch {
  command: string;
  args: string[];
  source: ProviderLaunchSource;
}

export interface ProviderLaunchAvailability {
  available: boolean;
  resolvedPath: string | null;
}

export interface ProviderLaunchDefault {
  command: string;
  resolvePath?: () => Promise<string | null>;
}

function normalizeLaunchDefault(
  defaultBinary: string | ProviderLaunchDefault,
): ProviderLaunchDefault {
  if (typeof defaultBinary === "string") {
    return { command: defaultBinary };
  }
  return defaultBinary;
}

async function resolveLaunchPath(command: string): Promise<string | null> {
  const found = await findExecutable(command);
  if (found) {
    return found;
  }
  if (isAbsolute(command)) {
    return executableExists(command);
  }
  return null;
}

async function resolveDefaultLaunchPath(
  defaultBinary: ProviderLaunchDefault,
): Promise<string | null> {
  return defaultBinary.resolvePath
    ? await defaultBinary.resolvePath()
    : await resolveLaunchPath(defaultBinary.command);
}

export interface ResolveProviderLaunchOptions {
  commandConfig?: ProviderCommand;
  defaultBinary?: string | ProviderLaunchDefault;
}

export async function resolveProviderLaunch({
  commandConfig,
  defaultBinary,
}: ResolveProviderLaunchOptions): Promise<ResolvedProviderLaunch> {
  if (commandConfig?.mode === "replace") {
    const command = commandConfig.argv[0];
    return {
      command,
      args: commandConfig.argv.slice(1),
      source: "override",
    };
  }

  if (defaultBinary === undefined) {
    throw new Error("defaultBinary is required when provider command is not replaced");
  }
  const normalizedDefault = normalizeLaunchDefault(defaultBinary);
  const args = commandConfig?.mode === "append" ? [...(commandConfig.args ?? [])] : [];
  return {
    command: normalizedDefault.command,
    args,
    source: commandConfig?.mode === "append" ? "append" : "default",
  };
}

export async function checkProviderLaunchAvailable(
  launch: ResolvedProviderLaunch,
  defaultBinary?: ProviderLaunchDefault,
): Promise<ProviderLaunchAvailability> {
  const resolvedPath =
    defaultBinary && launch.source !== "override"
      ? await resolveDefaultLaunchPath(defaultBinary)
      : await resolveLaunchPath(launch.command);
  return {
    available: resolvedPath !== null,
    resolvedPath,
  };
}

export async function resolveProviderCommandPrefix(
  commandConfig: ProviderCommand | undefined,
  resolveDefaultCommand: () => string | Promise<string>,
): Promise<ProviderCommandPrefix> {
  if (commandConfig?.mode === "replace") {
    const launch = await resolveProviderLaunch({
      commandConfig,
    });
    return {
      command: launch.command,
      args: launch.args,
    };
  }

  const defaultCommand = await resolveDefaultCommand();
  const launch = await resolveProviderLaunch({
    commandConfig,
    defaultBinary: {
      command: defaultCommand,
      resolvePath: async () => defaultCommand,
    },
  });
  return {
    command: launch.command,
    args: launch.args,
  };
}

let cachedShellEnv: Record<string, string> | null = null;

export function resolveShellEnv(): Record<string, string> {
  if (cachedShellEnv) {
    return cachedShellEnv;
  }
  cachedShellEnv = { ...process.env } as Record<string, string>;
  return cachedShellEnv;
}

export function migrateProviderSettings(
  raw: Record<string, unknown>,
  builtinProviderIds: string[],
): ProviderOverrides {
  const migrated: Record<string, ProviderOverride> = {};
  const builtinProviderIdSet = new Set(builtinProviderIds);

  for (const [providerId, value] of Object.entries(raw)) {
    const parsedNew = ProviderOverrideSchema.safeParse(value);
    if (parsedNew.success) {
      migrated[providerId] = parsedNew.data;
      continue;
    }

    const parsedOld = ProviderRuntimeSettingsSchema.safeParse(value);
    if (!parsedOld.success) {
      continue;
    }

    const nextEntry: ProviderOverride = {};
    const command = parsedOld.data.command;
    if (command?.mode === "append") {
      continue;
    }
    if (command?.mode === "replace") {
      nextEntry.command = command.argv;
    }
    if (parsedOld.data.env) {
      nextEntry.env = parsedOld.data.env;
    }
    if (!builtinProviderIdSet.has(providerId) && nextEntry.extends === undefined) {
      delete nextEntry.extends;
    }
    migrated[providerId] = nextEntry;
  }

  return ProviderOverridesSchema.parse(migrated);
}

// A Paseo terminal's hook identity, set per terminal by the terminal manager. A
// daemon started from inside a Paseo pane inherits that pane's values, and any
// agent it spawns would then post its hook activity into that pane.
export const TERMINAL_HOOK_IDENTITY_ENV_VARS = [
  "PASEO_TERMINAL_ID",
  "PASEO_ACTIVITY_TOKEN",
  "PASEO_TERMINAL_ACTIVITY_URL",
  "PASEO_HOOK_CLI",
] as const;

// What Claude Code sets for the processes it spawns. A daemon launched from inside a Claude Code
// session (an agent, or a terminal running claude) inherits it, and every terminal and agent it
// starts then looks like a child of that session: "cannot be launched inside another session"
// errors, transcript saving off, the parent's effort, the parent's messaging socket.
export const CLAUDE_SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_INVOKED_SKILLS",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
] as const;

const PARENT_SESSION_ENV_VARS = [...CLAUDE_SESSION_ENV_VARS, ...TERMINAL_HOOK_IDENTITY_ENV_VARS];

/** Undo what a parent Claude Code session injected into this process's environment. */
export function stripInheritedClaudeSessionEnv(env: ProcessEnvRecord): void {
  // Claude Code sets GIT_EDITOR=true for its tool shells; only drop it when that is its source,
  // so an editor the user configured survives.
  if (env.CLAUDECODE !== undefined && env.GIT_EDITOR === "true") {
    delete env.GIT_EDITOR;
  }
  for (const key of CLAUDE_SESSION_ENV_VARS) delete env[key];
}

export interface ProviderEnvOptions {
  baseEnv?: ProcessEnvRecord;
  runtimeSettings?: ProviderRuntimeSettings;
  overlays?: Array<ProcessEnvRecord | undefined>;
}

export interface ProviderEnvSpec {
  baseEnv?: ProcessEnvRecord;
  envOverlay: ProcessEnvRecord;
}

function collectProviderEnvOverlays(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  overlays: Array<ProcessEnvRecord | undefined>,
): ProcessEnvRecord[] {
  return [runtimeSettings?.env, ...overlays].filter(
    (overlay): overlay is ProcessEnvRecord => !!overlay,
  );
}

export function createProviderEnvSpec(options: ProviderEnvOptions = {}): ProviderEnvSpec {
  const overlays = collectProviderEnvOverlays(options.runtimeSettings, options.overlays ?? []);
  const envOverlay: ProcessEnvRecord = Object.assign({}, ...overlays);
  for (const key of PARENT_SESSION_ENV_VARS) {
    envOverlay[key] = undefined;
  }
  return {
    ...(options.baseEnv ? { baseEnv: options.baseEnv } : {}),
    envOverlay,
  };
}

export function createProviderEnv(options: ProviderEnvOptions = {}): NodeJS.ProcessEnv {
  const spec = createProviderEnvSpec(options);
  return createExternalProcessEnv(spec.baseEnv ?? process.env, spec.envOverlay);
}

export async function isProviderCommandAvailable(
  commandConfig: ProviderCommand | undefined,
  resolveDefaultCommand: () => string | Promise<string>,
): Promise<boolean> {
  try {
    if (commandConfig?.mode === "replace") {
      const launch = await resolveProviderLaunch({
        commandConfig,
      });
      const availability = await checkProviderLaunchAvailable(launch);
      return availability.available;
    }

    const defaultCommand = await resolveDefaultCommand();
    const defaultBinary = {
      command: defaultCommand,
      resolvePath: async () => defaultCommand,
    };
    const launch = await resolveProviderLaunch({ commandConfig, defaultBinary });
    const availability = await checkProviderLaunchAvailable(launch, defaultBinary);
    return availability.available;
  } catch {
    return false;
  }
}
