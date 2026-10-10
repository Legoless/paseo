import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Logger } from "pino";
import { z } from "zod";

import type { AgentModelDefinition } from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  type ACPPromptResponseContext,
  deriveSelectorOptions,
  findSelectConfigOption,
} from "./acp-agent.js";
import { toDiagnosticErrorMessage } from "./diagnostic-utils.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

const KimiTurnEndSchema = z.object({
  type: z.literal("turn.ended"),
  time: z.number(),
  reason: z.enum(["completed", "cancelled", "failed", "blocked"]),
  error: z
    .object({
      message: z.string().optional(),
      name: z.string().optional(),
      code: z.string().optional(),
    })
    .nullish(),
});

class KimiNativeTurnError extends Error {
  readonly code?: string;

  constructor(error: z.infer<typeof KimiTurnEndSchema>["error"]) {
    const message = error?.message?.trim() || "Kimi failed to complete the turn";
    const name = error?.name?.trim();
    // Kimi labels its 403 usage-limit failures "Authentication required" in the
    // journal; relaying that name sends the user to re-login, which never helps.
    const quota = KIMI_QUOTA_MESSAGE.test(message);
    super(quota || !name ? message : `${name}: ${message}`);
    this.name = "KimiNativeTurnError";
    this.code = quota ? "quota" : error?.code;
  }
}

const KIMI_QUOTA_MESSAGE = /usage limit|\bquota\b|rate limit/i;

// COMPAT(kimiSilentTurnFailure): added in v0.9.1, remove after 2027-01-03 once Kimi
// reports non-auth failures through ACP instead of mapping them to end_turn.
export async function validateKimiPromptResponse(context: ACPPromptResponseContext): Promise<void> {
  if (context.response.stopReason !== "end_turn" || !/^[A-Za-z0-9_-]+$/.test(context.sessionId)) {
    return;
  }
  const cwd = context.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const basename = cwd.split("/").pop() ?? cwd;
  const slug =
    basename
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "workspace";
  const workDirKey = `wd_${slug === "." || slug === ".." ? "workspace" : slug}_${createHash("sha256").update(cwd).digest("hex").slice(0, 12)}`;
  const home = context.env.KIMI_CODE_HOME || join(context.env.HOME || homedir(), ".kimi-code");
  const journalPath = resolve(
    context.cwd,
    home,
    "sessions",
    workDirKey,
    context.sessionId,
    "agents/main/wire.jsonl",
  );
  const deadline = Date.now() + 1000;
  while (true) {
    const tail = (await readKimiJournalTail(journalPath)) ?? "";
    for (const line of tail.split("\n").toReversed()) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = KimiTurnEndSchema.safeParse(value);
      if (!parsed.success || parsed.data.time < context.startedAt) continue;
      const { reason, error } = parsed.data;
      if (reason !== "failed") return;
      throw new KimiNativeTurnError(error);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await setTimeout(Math.min(25, remaining));
  }
}

async function readKimiJournalTail(journalPath: string): Promise<string | null> {
  try {
    const file = await open(journalPath, "r");
    try {
      const { size } = await file.stat();
      const start = Math.max(0, size - 64 * 1024);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      const firstLine = start > 0 ? text.indexOf("\n") + 1 : 0;
      const lastLine = text.lastIndexOf("\n");
      return lastLine < firstLine ? "" : text.slice(firstLine, lastLine);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

interface KimiACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

// Kimi exposes thinking options only for the selected model. Keep its model-switching
// discovery here: other providers can supply a read-only catalog instead.
export async function resolveKimiCatalogModels({
  connection,
  sessionId,
  models,
  configOptions,
  runRequest,
  transformConfigOptions,
  logger,
  provider,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  if (models.length <= 1) {
    return models;
  }
  const modelOption = findSelectConfigOption({ configOptions, category: "model" });
  if (!modelOption) {
    return models;
  }

  const resolved: AgentModelDefinition[] = [];
  for (const model of models) {
    try {
      const response = await runRequest(() =>
        connection.setSessionConfigOption({
          sessionId,
          configId: modelOption.id,
          value: model.id,
        }),
      );
      const modelConfigOptions = transformConfigOptions(response.configOptions ?? []);
      const thinkingOptions = deriveSelectorOptions(modelConfigOptions, "thought_level");
      resolved.push({
        ...model,
        thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
        defaultThinkingOptionId:
          thinkingOptions.find((option) => option.isDefault)?.id ?? undefined,
      });
    } catch (error) {
      const errorMessage = toDiagnosticErrorMessage(error);
      if (model.isDefault) {
        logger.warn(
          { modelId: model.id, error: errorMessage },
          `${provider} catalog probe could not refresh thinking options for current model "${model.id}"; keeping session options`,
        );
        resolved.push(model);
        continue;
      }
      logger.warn(
        { modelId: model.id, error: errorMessage },
        `${provider} catalog probe could not resolve thinking options for model "${model.id}"; omitting thinking options`,
      );
      resolved.push({
        ...model,
        thinkingOptions: undefined,
        defaultThinkingOptionId: undefined,
      });
    }
  }
  return resolved;
}

export class KimiACPAgentClient extends GenericACPAgentClient {
  constructor(options: KimiACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      catalogModelResolver: resolveKimiCatalogModels,
      promptResponseValidator: validateKimiPromptResponse,
    });
  }
}
