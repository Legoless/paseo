import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import { zSessionConfigOption } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";
import type { Logger } from "pino";
import { z } from "zod";

import type {
  AgentFeature,
  AgentModelDefinition,
  AgentSessionConfig,
  FetchCatalogOptions,
} from "../agent-sdk-types.js";
import {
  buildACPAutoAcceptFeature,
  deriveFeaturesFromACP,
  deriveSelectorOptions,
  findSelectConfigOption,
  type ACPCatalogModelResolverContext,
  type ACPConfigFeatureOption,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS = 10_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Select Cursor fast mode",
  icon: "zap",
};

const CursorModelCatalogSchema = z.object({
  models: z.array(
    z.object({
      value: z.string().min(1),
      name: z.string(),
      configOptions: z.array(zSessionConfigOption),
    }),
  ),
});

const CURSOR_BOOLEAN_THINKING_IDS = new Set(["true", "false"]);
const CURSOR_EFFORT_THINKING_IDS = new Set(["low", "medium", "high", "xhigh"]);

// session/new still advertises a thought_level option named `reasoning`. Cursor
// rejects writes to that id; the live model accepts `thinking` or `effort`.
export function resolveCursorThoughtLevelConfigId(thinkingOptionId: string): string {
  if (CURSOR_BOOLEAN_THINKING_IDS.has(thinkingOptionId)) {
    return "thinking";
  }
  if (CURSOR_EFFORT_THINKING_IDS.has(thinkingOptionId)) {
    return "effort";
  }
  throw new Error("cursor does not expose ACP thought-level selection");
}

export async function writeCursorThinkingOption(
  connection: ClientSideConnection,
  sessionId: string,
  thinkingOptionId: string,
): Promise<void> {
  await connection.setSessionConfigOption({
    sessionId,
    configId: resolveCursorThoughtLevelConfigId(thinkingOptionId),
    value: thinkingOptionId,
  });
}

// Cursor model switches persist CLI preferences, even in a throwaway probe session.
// Its extension returns each model's parameter definitions without selecting it.
export async function resolveCursorCatalogModels({
  connection,
  models,
  provider,
  runRequest,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  const catalog = await runRequest(() => fetchCursorModelCatalog(connection));
  const currentModelId = models.find((model) => model.isDefault)?.id;

  return catalog.models.map((model) => {
    const thoughtLevel = findSelectConfigOption({
      configOptions: model.configOptions,
      category: "thought_level",
    });
    const thinkingOptions = deriveSelectorOptions(model.configOptions, "thought_level");
    const defaultThinkingOptionId = thinkingOptions.find((option) => option.isDefault)?.id;
    const definition: AgentModelDefinition = {
      provider,
      id: model.value,
      label: model.name,
      isDefault: model.value === currentModelId,
      thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
      defaultThinkingOptionId,
    };
    if (thoughtLevel) {
      definition.metadata = { thoughtLevelConfigId: thoughtLevel.id };
    }
    return definition;
  });
}

async function fetchCursorModelCatalog(connection: ACPCatalogModelResolverContext["connection"]) {
  try {
    const response = await connection.extMethod("cursor/list_available_models", {});
    return CursorModelCatalogSchema.parse(response);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const extensionUnavailable = Number(code) === -32601;
    if (extensionUnavailable) {
      throw new Error(
        "Update Cursor CLI: this version does not support cursor/list_available_models.",
        { cause: error },
      );
    }
    throw error;
  }
}

export class CursorACPAgentClient extends GenericACPAgentClient {
  constructor(options: CursorACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_INITIAL_COMMANDS_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
      catalogModelResolver: resolveCursorCatalogModels,
      thinkingOptionWriter: writeCursorThinkingOption,
    });
  }

  async getCatalogCacheKey(_options: FetchCatalogOptions): Promise<string> {
    // cursor/list_available_models is host-wide. A per-cwd probe stampede is what
    // times out initialize and session/new when several workspaces hydrate at once.
    return "host";
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const selected = config.featureValues?.[CURSOR_FAST_FEATURE_OPTION.id];
    const selectedFast = typeof selected === "string" ? selected : "true";
    return [
      buildACPAutoAcceptFeature(config),
      ...deriveFeaturesFromACP(
        [
          {
            id: CURSOR_FAST_FEATURE_OPTION.configId,
            name: CURSOR_FAST_FEATURE_OPTION.label,
            type: "select",
            currentValue: selectedFast,
            options: [
              { value: "false", name: "Off" },
              { value: "true", name: "Fast" },
            ],
          },
        ],
        [CURSOR_FAST_FEATURE_OPTION],
      ),
    ];
  }
}
