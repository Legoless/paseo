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

const KimiAgentTurnEndSchema = z.object({
  type: z.literal("agent.turn.ended"),
  time: z.number(),
  outcome: z.enum(["done", "failed", "aborted"]),
  errorMessage: z.string().optional(),
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
const KIMI_JOURNAL_FLUSH_WAIT_MS = 1_000;
const KIMI_OPEN_TURN_SETTLE_MS = 400;
const KIMI_JOURNAL_POLL_MS = 25;
const KIMI_SESSION_ID = /^[A-Za-z0-9_-]+$/;

// Step and tool activity is appended as loop events. A long turn's start record
// scrolls out of the tail, so the last boundary in the tail decides ownership.
const KIMI_TURN_OPEN_TYPES = new Set([
  "agent.turn.started",
  "turn.prompt",
  "llm.request",
  "context.append_loop_event",
]);
const KIMI_TURN_CLOSE_TYPES = new Set([
  "agent.turn.ended",
  "turn.ended",
  "prompt.completed",
  "prompt.aborted",
]);

const KimiJournalEventSchema = z.object({
  type: z.string(),
  time: z.number(),
});

interface KimiJournalLocation {
  sessionId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function resolveKimiJournalPath(input: KimiJournalLocation): string {
  const cwd = input.cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const basename = cwd.split("/").pop() ?? cwd;
  const slug =
    basename
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/^-+|-+$/g, "") || "workspace";
  const workDirKey = `wd_${slug === "." || slug === ".." ? "workspace" : slug}_${createHash("sha256").update(cwd).digest("hex").slice(0, 12)}`;
  const home = input.env.KIMI_CODE_HOME || join(input.env.HOME || homedir(), ".kimi-code");
  return resolve(
    input.cwd,
    home,
    "sessions",
    workDirKey,
    input.sessionId,
    "agents/main/wire.jsonl",
  );
}

function kimiJournalEventType(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function kimiJournalTailHasOpenTurn(tail: string): boolean {
  let turnOpen = false;
  for (const line of tail.split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const type = kimiJournalEventType(value);
    if (!type) continue;
    if (KIMI_TURN_OPEN_TYPES.has(type)) {
      turnOpen = true;
    } else if (KIMI_TURN_CLOSE_TYPES.has(type)) {
      turnOpen = false;
    }
  }
  return turnOpen;
}

// True when this ACP prompt already has a native journal marker. An older open
// turn keeps emitting llm.request after startedAt, so that event is not a marker.
function kimiPromptHasMarker(tail: string, startedAt: number): "accepted" | "none" {
  for (const line of tail.split("\n").toReversed()) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = KimiTurnEndSchema.safeParse(value);
    if (parsed.success) {
      if (parsed.data.time < startedAt) continue;
      if (parsed.data.reason !== "failed") return "accepted";
      throw new KimiNativeTurnError(parsed.data.error);
    }
    // Kimi replays produced messages after turn.ended, which can push that
    // record outside the bounded tail. The compact summary follows the replay.
    const summary = KimiAgentTurnEndSchema.safeParse(value);
    if (summary.success) {
      if (summary.data.time < startedAt) continue;
      if (summary.data.outcome !== "failed") return "accepted";
      throw new KimiNativeTurnError({ message: summary.data.errorMessage });
    }
    const event = KimiJournalEventSchema.safeParse(value);
    if (!event.success || event.data.time < startedAt) continue;
    if (
      event.data.type === "turn.prompt" ||
      event.data.type === "agent.turn.started" ||
      event.data.type === "prompt.completed"
    ) {
      return "accepted";
    }
  }
  return "none";
}

// COMPAT(kimiSilentTurnFailure): added in v0.9.1, remove after 2027-01-03 once Kimi
// reports non-auth failures through ACP instead of mapping them to end_turn.
export async function validateKimiPromptResponse(context: ACPPromptResponseContext): Promise<void> {
  if (context.response.stopReason !== "end_turn" || !KIMI_SESSION_ID.test(context.sessionId)) {
    return;
  }
  const journalPath = resolveKimiJournalPath(context);
  const deadline = Date.now() + KIMI_JOURNAL_FLUSH_WAIT_MS;
  let tail = "";
  while (true) {
    tail = (await readKimiJournalTail(journalPath)) ?? "";
    if (kimiPromptHasMarker(tail, context.startedAt) === "accepted") return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await setTimeout(Math.min(KIMI_JOURNAL_POLL_MS, remaining));
  }
  // session/prompt resolves end_turn when Kimi only queued the text behind an
  // engine turn that is still running. There is no assistant output and no new
  // turn.prompt. Completing here leaves the user message unanswered.
  if (kimiJournalTailHasOpenTurn(tail)) {
    throw new KimiNativeTurnError({
      message: "Kimi left this prompt queued behind a turn that is still running. Send it again.",
      code: "kimi_turn_busy",
    });
  }
}

// Kimi's ACP driver can settle while the engine turn keeps running. The next
// prompt then queues forever on that process. Poll only after a first read says
// the turn is open, so a journal that already ended does not restart the process.
export async function kimiNativeTurnStillOpen(context: KimiJournalLocation): Promise<boolean> {
  if (!KIMI_SESSION_ID.test(context.sessionId)) return false;
  const journalPath = resolveKimiJournalPath(context);
  const first = await readKimiJournalTail(journalPath);
  if (first == null || !kimiJournalTailHasOpenTurn(first)) return false;
  const deadline = Date.now() + KIMI_OPEN_TURN_SETTLE_MS;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await setTimeout(Math.min(KIMI_JOURNAL_POLL_MS, remaining));
    const tail = await readKimiJournalTail(journalPath);
    if (tail == null || !kimiJournalTailHasOpenTurn(tail)) return false;
  }
  return true;
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
      catalogModelResolver: resolveKimiCatalogModels,
      promptResponseValidator: validateKimiPromptResponse,
      nativeTurnProbe: kimiNativeTurnStillOpen,
    });
  }
}
