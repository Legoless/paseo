import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { setTimeout } from "node:timers/promises";
import type { Logger } from "pino";
import { z } from "zod";

import type {
  AgentModelDefinition,
  AgentPromptInput,
  AgentSlashCommand,
  AgentStreamEvent,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  type ACPNativeSessionMonitor,
  type ACPNativeSessionMonitorContext,
  type ACPOutOfBandExecutionContext,
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
const KIMI_JOURNAL_TAIL_INITIAL_BYTES = 64 * 1024;
const KIMI_JOURNAL_TAIL_MAX_BYTES = 2 * 1024 * 1024;
const KIMI_SESSION_MONITOR_POLL_MS = 200;
const KIMI_BACKGROUND_ZERO_SETTLE_MS = 500;
const KIMI_SESSION_ID = /^[A-Za-z0-9_-]+$/;
const KIMI_MAX_GOAL_OBJECTIVE_LENGTH = 4_000;
const KIMI_GOAL_CONTROL_SUBCOMMANDS = new Set(["pause", "resume", "cancel", "clear"]);

const KIMI_GOAL_COMMAND: AgentSlashCommand = {
  name: "goal",
  description: "Start or manage an autonomous goal",
  argumentHint: "[status|pause|resume|cancel|replace] | <objective>",
  kind: "command",
};

type KimiGoalSlashCommand =
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "cancel" }
  | { kind: "create"; objective: string; replace: boolean }
  | { kind: "error"; message: string };

function extractTypedKimiPromptText(prompt: AgentPromptInput): {
  text: string;
  hasAttachments: boolean;
} | null {
  if (typeof prompt === "string") {
    return { text: prompt, hasAttachments: false };
  }
  const first = prompt[0];
  if (!first || first.type !== "text" || "mimeType" in first) {
    return null;
  }
  return { text: first.text, hasAttachments: prompt.length > 1 };
}

function stripLeadingToken(text: string, expected: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed === expected) {
    return "";
  }
  if (trimmed.startsWith(expected) && /\s/.test(trimmed[expected.length] ?? "")) {
    return trimmed.slice(expected.length).trimStart();
  }
  return null;
}

export function parseKimiGoalSlashCommand(prompt: AgentPromptInput): KimiGoalSlashCommand | null {
  const extracted = extractTypedKimiPromptText(prompt);
  if (!extracted) {
    return null;
  }
  const match = /^\s*\/goal(?=$|\s)([\s\S]*)$/i.exec(extracted.text);
  if (!match) {
    return null;
  }
  const rawArgs = (match[1] ?? "").trim();
  if (!extracted.hasAttachments) {
    if (rawArgs.length === 0 || rawArgs === "status") {
      return { kind: "status" };
    }
    const tokens = rawArgs.split(/\s+/);
    const first = tokens[0]?.toLowerCase();
    if (first && KIMI_GOAL_CONTROL_SUBCOMMANDS.has(first) && tokens.length === 1) {
      if (first === "pause") return { kind: "pause" };
      if (first === "resume") return { kind: "resume" };
      return { kind: "cancel" };
    }
  }

  let remainder = rawArgs;
  let replace = false;
  const afterReplace = stripLeadingToken(remainder, "replace");
  if (afterReplace !== null) {
    replace = true;
    remainder = afterReplace;
  }
  const afterDashDash = stripLeadingToken(remainder, "--");
  if (afterDashDash !== null) {
    remainder = afterDashDash;
  }

  const objective = remainder.trim();
  if (objective.length === 0) {
    return {
      kind: "error",
      message: "Provide a goal objective, e.g. `/goal Fix all parity gaps`.",
    };
  }
  if (objective.length > KIMI_MAX_GOAL_OBJECTIVE_LENGTH) {
    return {
      kind: "error",
      message: `Goal objective is too long (max ${KIMI_MAX_GOAL_OBJECTIVE_LENGTH} characters). Put long content in a file and reference the file path.`,
    };
  }
  return { kind: "create", objective, replace };
}

function formatKimiGoalCreatePrompt(objective: string, replace: boolean): string {
  const replaceInstruction = replace
    ? "Pass `replace: true` to `CreateGoal` so it replaces any existing goal."
    : "Pass `replace: false`; if `CreateGoal` reports that a goal already exists, tell the user to run `/goal replace <objective>` or `/goal status` and stop.";
  return [
    "Host goal-intake prompt: the user explicitly invoked `/goal` to start autonomous goal mode now.",
    `Call \`CreateGoal\` immediately with the exact \`objective\` below. ${replaceInstruction}`,
    "Do not ask for confirmation or a narrower completion criterion before calling `CreateGoal` — start the goal as written.",
    "If the objective states an explicit hard budget (turns, tokens, or duration), also call `SetGoalBudget`.",
    "Once the goal is created, begin working toward the objective immediately in this turn.",
    "",
    "Objective:",
    objective,
  ].join("\n");
}

function formatKimiGoalResumePrompt(): string {
  return [
    "Host goal-resume prompt: the user explicitly invoked `/goal resume`.",
    'Call `UpdateGoal` with `status: "active"` now to resume the current goal, then continue working toward its objective in this turn.',
    "If there is no current goal to resume, tell the user that no goal is set and stop.",
  ].join("\n");
}

export function transformKimiSlashCommands(commands: AgentSlashCommand[]): AgentSlashCommand[] {
  if (commands.some((command) => command.name === KIMI_GOAL_COMMAND.name)) {
    return commands;
  }
  return [...commands, KIMI_GOAL_COMMAND];
}

export function transformKimiPromptBlocks(
  blocks: ContentBlock[],
  prompt: AgentPromptInput,
): ContentBlock[] {
  const parsed = parseKimiGoalSlashCommand(prompt);
  if (!parsed || blocks.length === 0 || blocks[0]?.type !== "text") {
    return blocks;
  }
  if (parsed.kind === "create") {
    return [
      { type: "text", text: formatKimiGoalCreatePrompt(parsed.objective, parsed.replace) },
      ...blocks.slice(1),
    ];
  }
  if (parsed.kind === "resume") {
    return [{ type: "text", text: formatKimiGoalResumePrompt() }, ...blocks.slice(1)];
  }
  return blocks;
}

interface KimiGoalBudgetLimits {
  tokenBudget?: number;
  turnBudget?: number;
  wallClockBudgetMs?: number;
}

interface KimiGoalSnapshot {
  goalId: string;
  objective: string;
  completionCriterion?: string;
  status: "active" | "paused" | "blocked" | "complete";
  terminalReason?: string;
  turnsUsed: number;
  tokensUsed: number;
  wallClockMs: number;
  wallClockResumedAt?: number;
  budgetLimits: KimiGoalBudgetLimits;
}

function parseKimiGoalBudgetLimits(raw: unknown): KimiGoalBudgetLimits | undefined {
  if (!isObjectRecord(raw)) return undefined;
  const limits: KimiGoalBudgetLimits = {};
  if (typeof raw.tokenBudget === "number" && Number.isFinite(raw.tokenBudget)) {
    limits.tokenBudget = raw.tokenBudget;
  }
  if (typeof raw.turnBudget === "number" && Number.isFinite(raw.turnBudget)) {
    limits.turnBudget = raw.turnBudget;
  }
  if (typeof raw.wallClockBudgetMs === "number" && Number.isFinite(raw.wallClockBudgetMs)) {
    limits.wallClockBudgetMs = raw.wallClockBudgetMs;
  }
  return limits;
}

type KimiGoalStatus = KimiGoalSnapshot["status"];

function isKimiGoalStatus(value: unknown): value is KimiGoalStatus {
  return value === "active" || value === "paused" || value === "blocked" || value === "complete";
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveGoalTerminalReason(
  current: KimiGoalSnapshot,
  nextStatus: KimiGoalStatus,
  reason: unknown,
): string | undefined {
  if (nextStatus === current.status) {
    return current.terminalReason;
  }
  if (nextStatus === "active") {
    return undefined;
  }
  return typeof reason === "string" ? reason : undefined;
}

function resolveGoalResumedAt(
  current: KimiGoalSnapshot,
  nextStatus: KimiGoalStatus,
  wallClockResumedAt: unknown,
): number | undefined {
  if (nextStatus !== "active") {
    return undefined;
  }
  if (typeof wallClockResumedAt === "number" && Number.isFinite(wallClockResumedAt)) {
    return wallClockResumedAt;
  }
  return current.wallClockResumedAt;
}

function createKimiGoalSnapshotFromRecord(
  record: Record<string, unknown>,
  fallback: KimiGoalSnapshot | null,
): KimiGoalSnapshot | null {
  if (typeof record.goalId !== "string" || typeof record.objective !== "string") {
    return fallback;
  }
  return {
    goalId: record.goalId,
    objective: record.objective,
    completionCriterion:
      typeof record.completionCriterion === "string" ? record.completionCriterion : undefined,
    status: isKimiGoalStatus(record.status) ? record.status : "active",
    turnsUsed: 0,
    tokensUsed: 0,
    wallClockMs: 0,
    wallClockResumedAt:
      typeof record.wallClockResumedAt === "number" ? record.wallClockResumedAt : undefined,
    budgetLimits: parseKimiGoalBudgetLimits(record.budgetLimits) ?? {},
  };
}

function updateKimiGoalSnapshotFromRecord(
  current: KimiGoalSnapshot,
  record: Record<string, unknown>,
): KimiGoalSnapshot {
  const nextStatus = isKimiGoalStatus(record.status) ? record.status : current.status;
  return {
    ...current,
    objective: typeof record.objective === "string" ? record.objective : current.objective,
    status: nextStatus,
    terminalReason: resolveGoalTerminalReason(current, nextStatus, record.reason),
    turnsUsed: readFiniteNumber(record.turnsUsed, current.turnsUsed),
    tokensUsed: readFiniteNumber(record.tokensUsed, current.tokensUsed),
    wallClockMs: readFiniteNumber(record.wallClockMs, current.wallClockMs),
    wallClockResumedAt: resolveGoalResumedAt(current, nextStatus, record.wallClockResumedAt),
    budgetLimits: parseKimiGoalBudgetLimits(record.budgetLimits) ?? current.budgetLimits,
  };
}

function applyKimiGoalStateLine(
  current: KimiGoalSnapshot | null,
  line: string,
): KimiGoalSnapshot | null {
  const record = parseMainKimiJournalRecord(line);
  if (!record) {
    return current;
  }
  if (
    record.type === "goal.clear" ||
    record.type === "session.forked" ||
    record.type === "forked"
  ) {
    return null;
  }
  if (record.type === "goal.create") {
    return createKimiGoalSnapshotFromRecord(record, current);
  }
  if (record.type === "goal.update" && current !== null) {
    return updateKimiGoalSnapshotFromRecord(current, record);
  }
  return current;
}

async function readKimiGoalSnapshot(
  location: KimiJournalLocation,
): Promise<KimiGoalSnapshot | null> {
  if (!KIMI_SESSION_ID.test(location.sessionId)) {
    return null;
  }
  const journalPath = resolveKimiJournalPath(location);
  try {
    const file = await open(journalPath, "r");
    try {
      const buffer = Buffer.alloc(KIMI_JOURNAL_TAIL_INITIAL_BYTES);
      const decoder = new StringDecoder("utf8");
      let offset = 0;
      let remainder = "";
      let state: KimiGoalSnapshot | null = null;
      while (true) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        remainder += decoder.write(buffer.subarray(0, bytesRead));
        let newlineIdx = remainder.indexOf("\n");
        while (newlineIdx >= 0) {
          state = applyKimiGoalStateLine(state, remainder.slice(0, newlineIdx));
          remainder = remainder.slice(newlineIdx + 1);
          newlineIdx = remainder.indexOf("\n");
        }
      }
      remainder += decoder.end();
      if (remainder.trim().length > 0) {
        state = applyKimiGoalStateLine(state, remainder);
      }
      return state;
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

function formatKimiElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${(minutes % 60).toString().padStart(2, "0")}m`;
}

function formatKimiGoalStatusMessage(snapshot: KimiGoalSnapshot | null): string {
  if (!snapshot) {
    return "No goal set. Start one with `/goal <objective>`.";
  }
  const liveElapsedMs =
    snapshot.status === "active" && snapshot.wallClockResumedAt !== undefined
      ? snapshot.wallClockMs + Math.max(0, Date.now() - snapshot.wallClockResumedAt)
      : snapshot.wallClockMs;
  const lines = [`Goal (${snapshot.status}): ${snapshot.objective}`];
  if (snapshot.completionCriterion) {
    lines.push(`Completion criterion: ${snapshot.completionCriterion}`);
  }
  if (snapshot.terminalReason) {
    lines.push(`Reason: ${snapshot.terminalReason}`);
  }
  lines.push(
    `Progress: ${snapshot.turnsUsed} turns, ${snapshot.tokensUsed} tokens, ${formatKimiElapsedDuration(liveElapsedMs)}`,
  );
  const budgets: string[] = [];
  if (snapshot.budgetLimits.turnBudget !== undefined) {
    budgets.push(`${snapshot.budgetLimits.turnBudget} turns`);
  }
  if (snapshot.budgetLimits.tokenBudget !== undefined) {
    budgets.push(`${snapshot.budgetLimits.tokenBudget} tokens`);
  }
  if (snapshot.budgetLimits.wallClockBudgetMs !== undefined) {
    budgets.push(formatKimiElapsedDuration(snapshot.budgetLimits.wallClockBudgetMs));
  }
  if (budgets.length > 0) {
    lines.push(`Budgets: ${budgets.join(", ")}`);
  }
  return lines.join("\n");
}

function emitKimiOutOfBandMessage(
  provider: string,
  emit: (event: AgentStreamEvent) => void,
  text: string,
): void {
  emit({
    type: "timeline",
    provider,
    item: { type: "assistant_message", text },
  });
}

async function appendKimiJournalRecord(
  journalPath: string,
  record: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(journalPath), { recursive: true });
  await appendFile(journalPath, `${JSON.stringify(record)}\n`, "utf8");
}

export function handleKimiOutOfBandPrompt(
  prompt: AgentPromptInput,
): { run(ctx: ACPOutOfBandExecutionContext): Promise<void> } | null {
  const parsed = parseKimiGoalSlashCommand(prompt);
  if (!parsed || parsed.kind === "create" || parsed.kind === "resume") {
    return null;
  }
  return {
    run: async (ctx) => {
      if (parsed.kind === "error") {
        emitKimiOutOfBandMessage(ctx.provider, ctx.emit, parsed.message);
        return;
      }
      if (!ctx.sessionId || !KIMI_SESSION_ID.test(ctx.sessionId)) {
        emitKimiOutOfBandMessage(
          ctx.provider,
          ctx.emit,
          "No goal set. Start one with `/goal <objective>`.",
        );
        return;
      }
      const location: KimiJournalLocation = {
        sessionId: ctx.sessionId,
        cwd: ctx.cwd,
        env: ctx.env,
      };
      const snapshot = await readKimiGoalSnapshot(location);
      if (parsed.kind === "status") {
        emitKimiOutOfBandMessage(ctx.provider, ctx.emit, formatKimiGoalStatusMessage(snapshot));
        return;
      }
      const journalPath = resolveKimiJournalPath(location);
      if (parsed.kind === "pause") {
        if (!snapshot) {
          emitKimiOutOfBandMessage(ctx.provider, ctx.emit, "No goal to pause.");
          return;
        }
        if (snapshot.status === "paused") {
          emitKimiOutOfBandMessage(
            ctx.provider,
            ctx.emit,
            "Goal is already paused. Use `/goal resume` to continue.",
          );
          return;
        }
        if (snapshot.status !== "active") {
          emitKimiOutOfBandMessage(
            ctx.provider,
            ctx.emit,
            `Cannot pause a goal in status "${snapshot.status}".`,
          );
          return;
        }
        await ctx.reopenSession(async () => {
          const afterClose = await readKimiGoalSnapshot(location);
          if (afterClose?.status === "active") {
            await appendKimiJournalRecord(journalPath, {
              type: "goal.update",
              agentId: "main",
              status: "paused",
              reason: "Paused by user",
              actor: "user",
              time: Date.now(),
            });
          }
        });
        emitKimiOutOfBandMessage(
          ctx.provider,
          ctx.emit,
          "Goal paused. Use `/goal resume` to continue.",
        );
        return;
      }
      if (!snapshot) {
        emitKimiOutOfBandMessage(ctx.provider, ctx.emit, "No goal to cancel.");
        return;
      }
      await ctx.reopenSession(async () => {
        await appendKimiJournalRecord(journalPath, {
          type: "goal.clear",
          agentId: "main",
          time: Date.now(),
        });
      });
      emitKimiOutOfBandMessage(ctx.provider, ctx.emit, "Goal cancelled.");
    },
  };
}

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
const KIMI_COMPACTION_OPEN_TYPE = "full_compaction.begin";
const KIMI_COMPACTION_CLOSE_TYPES = new Set(["full_compaction.complete", "full_compaction.cancel"]);

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
  let compactionOpen = false;
  for (const line of tail.split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const type = kimiJournalEventType(value);
    if (!type) continue;
    if (type === KIMI_COMPACTION_OPEN_TYPE) {
      compactionOpen = true;
    } else if (KIMI_COMPACTION_CLOSE_TYPES.has(type)) {
      compactionOpen = false;
    } else if (type === "llm.request") {
      if (!compactionOpen) {
        turnOpen = true;
      }
    } else if (KIMI_TURN_OPEN_TYPES.has(type)) {
      turnOpen = true;
    } else if (KIMI_TURN_CLOSE_TYPES.has(type)) {
      turnOpen = false;
    }
  }
  return turnOpen || compactionOpen;
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
      event.data.type === "prompt.completed" ||
      event.data.type === KIMI_COMPACTION_OPEN_TYPE ||
      KIMI_COMPACTION_CLOSE_TYPES.has(event.data.type)
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

function kimiJournalTailHasBoundary(tail: string): boolean {
  for (const line of tail.split("\n")) {
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const type = kimiJournalEventType(value);
    if (
      type &&
      (KIMI_TURN_OPEN_TYPES.has(type) ||
        KIMI_TURN_CLOSE_TYPES.has(type) ||
        type === KIMI_COMPACTION_OPEN_TYPE ||
        KIMI_COMPACTION_CLOSE_TYPES.has(type))
    ) {
      return true;
    }
  }
  return false;
}

async function readKimiJournalTail(journalPath: string): Promise<string | null> {
  try {
    const file = await open(journalPath, "r");
    try {
      const { size } = await file.stat();
      if (size === 0) return "";
      let windowBytes = KIMI_JOURNAL_TAIL_INITIAL_BYTES;
      while (true) {
        const start = Math.max(0, size - windowBytes);
        const buffer = Buffer.alloc(size - start);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        const firstNewline = text.indexOf("\n");
        let firstLine = 0;
        if (start > 0) {
          firstLine = firstNewline < 0 ? text.length : firstNewline + 1;
        }
        const lastLine = text.lastIndexOf("\n");
        const slice = lastLine < firstLine ? "" : text.slice(firstLine, lastLine);
        if (
          start === 0 ||
          windowBytes >= KIMI_JOURNAL_TAIL_MAX_BYTES ||
          (lastLine >= firstLine && kimiJournalTailHasBoundary(slice))
        ) {
          return slice;
        }
        windowBytes = Math.min(windowBytes * 2, KIMI_JOURNAL_TAIL_MAX_BYTES);
      }
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

interface KimiMonitorOptions {
  pollIntervalMs?: number;
  backgroundZeroSettleMs?: number;
}

interface KimiAutonomousTurnState {
  turnId: string;
  nativeTurnId: string | null;
  toolCalls: Map<string, ToolCallTimelineItem>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMainKimiAgentRecord(record: Record<string, unknown>): boolean {
  return record.agentId === undefined || record.agentId === "main";
}

function parseMainKimiJournalRecord(
  line: string,
): (Record<string, unknown> & { type: string }) | null {
  if (!line.trim()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !isObjectRecord(parsed) ||
    typeof parsed.type !== "string" ||
    !isMainKimiAgentRecord(parsed)
  ) {
    return null;
  }
  return parsed as Record<string, unknown> & { type: string };
}

function readKimiNativeTurnId(record: Record<string, unknown>): string | null {
  const candidate =
    record.turnId ?? (isObjectRecord(record.event) ? record.event.turnId : undefined);
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  return null;
}

function readKimiStringField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
  fallback: string,
): string {
  if (record) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return fallback;
}

function mapKimiEditToolDetail(
  name: string,
  record: Record<string, unknown> | null,
): ToolCallDetail {
  const filePath = readKimiStringField(record, ["path", "file_path"], name);
  const edit = isObjectRecord(record?.edit) ? record.edit : record;
  return {
    type: "edit",
    filePath,
    ...(typeof edit?.old === "string" ? { oldString: edit.old } : {}),
    ...(typeof edit?.new === "string" ? { newString: edit.new } : {}),
  };
}

function mapKimiLoopToolDetail(name: string, args: unknown): ToolCallDetail {
  const record = isObjectRecord(args) ? args : null;
  switch (name.toLowerCase()) {
    case "shell":
    case "bash":
      return {
        type: "shell",
        command: readKimiStringField(record, ["command"], name),
      };
    case "readfile":
    case "read_file":
      return {
        type: "read",
        filePath: readKimiStringField(record, ["path", "file_path"], name),
      };
    case "writefile":
    case "write_file":
      return {
        type: "write",
        filePath: readKimiStringField(record, ["path", "file_path"], name),
        ...(typeof record?.content === "string" ? { content: record.content } : {}),
      };
    case "strreplacefile":
    case "str_replace_file":
      return mapKimiEditToolDetail(name, record);
    case "grep":
    case "glob":
    case "searchweb":
    case "search_web":
      return {
        type: "search",
        query: readKimiStringField(record, ["pattern", "query"], name),
      };
    default:
      return {
        type: "unknown",
        input: args ?? null,
        output: null,
      };
  }
}

function attachKimiToolResultOutput(
  detail: ToolCallDetail,
  output: string | undefined,
  rawResult: unknown,
): ToolCallDetail {
  switch (detail.type) {
    case "shell":
      return output !== undefined ? { ...detail, output } : detail;
    case "read":
    case "search":
      return output !== undefined ? { ...detail, content: output } : detail;
    case "unknown":
      return { ...detail, output: output ?? rawResult ?? null };
    default:
      return detail;
  }
}

// Kimi's ACP server drops stdout updates once `session/prompt` settles, even while
// detached tasks, subagents, `/goal` loops, and task-wakeup turns keep running in
// the same process and writing `agents/main/wire.jsonl`. Follow that journal so
// background work keeps the agent running and autonomous turns reach the timeline.
export async function createKimiNativeSessionMonitor(
  context: ACPNativeSessionMonitorContext,
  options?: KimiMonitorOptions,
): Promise<ACPNativeSessionMonitor | null> {
  if (!KIMI_SESSION_ID.test(context.sessionId)) {
    return null;
  }

  const journalPath = resolveKimiJournalPath(context);
  const pollIntervalMs = options?.pollIntervalMs ?? KIMI_SESSION_MONITOR_POLL_MS;
  const backgroundZeroSettleMs = options?.backgroundZeroSettleMs ?? KIMI_BACKGROUND_ZERO_SETTLE_MS;

  let offset = 0;
  let skipPartialFirstLine = false;
  if (!context.fromStart) {
    try {
      const file = await open(journalPath, "r");
      try {
        const { size } = await file.stat();
        if (size > 0) {
          const tailByte = Buffer.alloc(1);
          const { bytesRead } = await file.read(tailByte, 0, 1, size - 1);
          offset = size;
          skipPartialFirstLine = bytesRead === 1 && tailByte[0] !== 0x0a;
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        context.logger.debug(
          { err: error, journalPath },
          "Could not stat Kimi journal during session resume",
        );
      }
    }
  }

  const runningTaskIds = new Set<string>();
  const foregroundNativeTurnIds = new Set<string>();
  const closedNativeTurnIds = new Set<string>();
  let activeGoal = false;
  let compacting = false;
  let emittedBackgroundWorkCount = 0;
  let currentNativeTurnOwner: "foreground" | "autonomous" | null = null;
  let autonomousTurn: KimiAutonomousTurnState | null = null;
  let remainder = "";
  let decoder = new StringDecoder("utf8");
  let closed = false;
  let runtimeExited = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let zeroSettleTimer: NodeJS.Timeout | null = null;
  let syncChain: Promise<void> = Promise.resolve();

  const desiredBackgroundWorkCount = (): number =>
    runningTaskIds.size + (activeGoal ? 1 : 0) + (compacting ? 1 : 0);

  const clearZeroSettleTimer = (): void => {
    if (zeroSettleTimer) {
      clearTimeout(zeroSettleTimer);
      zeroSettleTimer = null;
    }
  };

  const clearAllTimers = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    clearZeroSettleTimer();
  };

  const emitBackgroundWorkCount = (count: number): void => {
    clearZeroSettleTimer();
    if (count === emittedBackgroundWorkCount) {
      return;
    }
    emittedBackgroundWorkCount = count;
    context.emit({
      type: "background_work_changed",
      provider: context.provider,
      count,
    });
  };

  const reconcileBackgroundWorkCount = (immediateZero: boolean): void => {
    if (closed || runtimeExited) {
      return;
    }
    const desired = desiredBackgroundWorkCount();
    if (desired === emittedBackgroundWorkCount) {
      if (desired > 0) {
        clearZeroSettleTimer();
      }
      return;
    }
    if (
      desired > 0 ||
      immediateZero ||
      autonomousTurn !== null ||
      context.isForegroundTurnActive()
    ) {
      emitBackgroundWorkCount(desired);
      return;
    }
    // `task.terminated` lands a few milliseconds before Kimi opens its autonomous
    // wakeup turn (`agent.turn.started`). Re-read once before dropping to 0 so the
    // agent does not flash finished green between the two records.
    if (!zeroSettleTimer) {
      zeroSettleTimer = globalThis.setTimeout(() => {
        zeroSettleTimer = null;
        void enqueueSync(true);
      }, backgroundZeroSettleMs);
      zeroSettleTimer.unref?.();
    }
  };

  const openAutonomousTurn = (nativeTurnId: string | null): KimiAutonomousTurnState => {
    if (autonomousTurn) {
      if (autonomousTurn.nativeTurnId === null && nativeTurnId !== null) {
        autonomousTurn.nativeTurnId = nativeTurnId;
      }
      return autonomousTurn;
    }
    clearZeroSettleTimer();
    const opened: KimiAutonomousTurnState = {
      turnId: randomUUID(),
      nativeTurnId,
      toolCalls: new Map(),
    };
    autonomousTurn = opened;
    currentNativeTurnOwner = "autonomous";
    context.emit({
      type: "turn_started",
      provider: context.provider,
      turnId: opened.turnId,
    });
    reconcileBackgroundWorkCount(true);
    return opened;
  };

  const synthesizeCanceledAutonomousTools = (turn: KimiAutonomousTurnState): void => {
    for (const item of turn.toolCalls.values()) {
      if (item.status === "running") {
        context.emit({
          type: "timeline",
          provider: context.provider,
          turnId: turn.turnId,
          item: {
            ...item,
            status: "canceled",
            error: null,
          },
        });
      }
    }
  };

  const emitAutonomousContentPart = (
    turn: KimiAutonomousTurnState,
    rawEvent: Record<string, unknown>,
  ): void => {
    const part = isObjectRecord(rawEvent.part) ? rawEvent.part : null;
    if (!part || typeof part.type !== "string") return;
    if (part.type === "think" && part.hidden !== true && typeof part.think === "string") {
      if (part.think.trim().length > 0) {
        context.emit({
          type: "timeline",
          provider: context.provider,
          turnId: turn.turnId,
          item: { type: "reasoning", text: part.think },
        });
      }
      return;
    }
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      context.emit({
        type: "timeline",
        provider: context.provider,
        turnId: turn.turnId,
        item: {
          type: "assistant_message",
          text: part.text,
          messageId: typeof rawEvent.uuid === "string" ? rawEvent.uuid : randomUUID(),
        },
      });
    }
  };

  const emitAutonomousToolCall = (
    turn: KimiAutonomousTurnState,
    rawEvent: Record<string, unknown>,
  ): void => {
    const callId = typeof rawEvent.toolCallId === "string" ? rawEvent.toolCallId : null;
    const name = typeof rawEvent.name === "string" ? rawEvent.name : null;
    if (!callId || !name) return;
    if (
      name === "TodoList" &&
      isObjectRecord(rawEvent.args) &&
      Array.isArray(rawEvent.args.todos)
    ) {
      const items = rawEvent.args.todos.flatMap((entry) =>
        isObjectRecord(entry) && typeof entry.title === "string"
          ? [{ text: entry.title, completed: entry.status === "completed" }]
          : [],
      );
      context.emit({
        type: "timeline",
        provider: context.provider,
        turnId: turn.turnId,
        item: { type: "todo", items },
      });
      return;
    }
    const item: ToolCallTimelineItem = {
      type: "tool_call",
      callId,
      name,
      status: "running",
      detail: mapKimiLoopToolDetail(name, rawEvent.args),
      error: null,
    };
    turn.toolCalls.set(callId, item);
    context.emit({
      type: "timeline",
      provider: context.provider,
      turnId: turn.turnId,
      item,
    });
  };

  const emitAutonomousToolResult = (
    turn: KimiAutonomousTurnState,
    rawEvent: Record<string, unknown>,
  ): void => {
    const callId = typeof rawEvent.toolCallId === "string" ? rawEvent.toolCallId : null;
    const existing = callId ? turn.toolCalls.get(callId) : undefined;
    if (!callId || !existing) return;
    const resultRecord = isObjectRecord(rawEvent.result) ? rawEvent.result : null;
    const output = typeof resultRecord?.output === "string" ? resultRecord.output : undefined;
    const isError = resultRecord?.isError === true || resultRecord?.is_error === true;
    const detail = attachKimiToolResultOutput(existing.detail, output, rawEvent.result);
    const updated: ToolCallTimelineItem = isError
      ? {
          ...existing,
          detail,
          status: "failed",
          error: {
            message: readKimiStringField(resultRecord, ["output", "message"], "Tool call failed"),
          },
        }
      : {
          ...existing,
          detail,
          status: "completed",
          error: null,
        };
    turn.toolCalls.set(callId, updated);
    context.emit({
      type: "timeline",
      provider: context.provider,
      turnId: turn.turnId,
      item: updated,
    });
  };

  const emitAutonomousLoopEvent = (turn: KimiAutonomousTurnState, rawEvent: unknown): void => {
    if (!isObjectRecord(rawEvent) || typeof rawEvent.type !== "string") {
      return;
    }
    switch (rawEvent.type) {
      case "content.part":
        emitAutonomousContentPart(turn, rawEvent);
        return;
      case "tool.call":
        emitAutonomousToolCall(turn, rawEvent);
        return;
      case "tool.result":
        emitAutonomousToolResult(turn, rawEvent);
        return;
      default:
        return;
    }
  };

  const closeAutonomousTurnFromRecord = (
    turn: KimiAutonomousTurnState,
    record: Record<string, unknown>,
  ): void => {
    const desired = desiredBackgroundWorkCount();
    if (desired > emittedBackgroundWorkCount) {
      emitBackgroundWorkCount(desired);
    }

    autonomousTurn = null;
    currentNativeTurnOwner = null;

    const turnEnded = KimiTurnEndSchema.safeParse(record);
    if (turnEnded.success) {
      if (turnEnded.data.reason === "failed") {
        const err = new KimiNativeTurnError(turnEnded.data.error);
        context.emit({
          type: "turn_failed",
          provider: context.provider,
          error: err.message,
          code: err.code,
          turnId: turn.turnId,
        });
        return;
      }
      if (turnEnded.data.reason === "cancelled") {
        synthesizeCanceledAutonomousTools(turn);
        context.emit({
          type: "turn_canceled",
          provider: context.provider,
          reason: "Interrupted",
          turnId: turn.turnId,
        });
        return;
      }
      context.emit({
        type: "turn_completed",
        provider: context.provider,
        turnId: turn.turnId,
      });
      return;
    }

    const summaryEnded = KimiAgentTurnEndSchema.safeParse(record);
    if (summaryEnded.success) {
      if (summaryEnded.data.outcome === "failed") {
        const err = new KimiNativeTurnError({ message: summaryEnded.data.errorMessage });
        context.emit({
          type: "turn_failed",
          provider: context.provider,
          error: err.message,
          code: err.code,
          turnId: turn.turnId,
        });
        return;
      }
      if (summaryEnded.data.outcome === "aborted") {
        synthesizeCanceledAutonomousTools(turn);
        context.emit({
          type: "turn_canceled",
          provider: context.provider,
          reason: "Interrupted",
          turnId: turn.turnId,
        });
        return;
      }
    }

    if (record.type === "prompt.aborted") {
      synthesizeCanceledAutonomousTools(turn);
      context.emit({
        type: "turn_canceled",
        provider: context.provider,
        reason: "Interrupted",
        turnId: turn.turnId,
      });
      return;
    }

    context.emit({
      type: "turn_completed",
      provider: context.provider,
      turnId: turn.turnId,
    });
  };

  const applyBackgroundStateRecord = (type: string, record: Record<string, unknown>): boolean => {
    const info = isObjectRecord(record.info) ? record.info : null;
    const taskId = typeof info?.taskId === "string" ? info.taskId.trim() : "";
    switch (type) {
      case "task.started": {
        const status = typeof info?.status === "string" ? info.status : "running";
        if (taskId && status === "running") {
          runningTaskIds.add(taskId);
        }
        return true;
      }
      case "task.terminated":
        if (taskId) {
          runningTaskIds.delete(taskId);
        }
        return true;
      case "goal.create":
        activeGoal = typeof record.status === "string" ? record.status === "active" : true;
        return true;
      case "goal.update":
        if (typeof record.status === "string") {
          activeGoal = record.status === "active";
        }
        return true;
      case "goal.clear":
        activeGoal = false;
        return true;
      case KIMI_COMPACTION_OPEN_TYPE:
        compacting = true;
        return true;
      case "full_compaction.complete":
      case "full_compaction.cancel":
        compacting = false;
        return true;
      default:
        return false;
    }
  };

  const claimForegroundNativeTurn = (
    nativeTurnId: string | null,
    allowImplicitOwner: boolean,
  ): boolean => {
    const belongsToForeground =
      context.isForegroundTurnActive() ||
      (nativeTurnId !== null && foregroundNativeTurnIds.has(nativeTurnId)) ||
      (allowImplicitOwner && nativeTurnId === null && currentNativeTurnOwner === "foreground");
    if (!belongsToForeground) {
      return false;
    }
    if (nativeTurnId !== null) {
      foregroundNativeTurnIds.add(nativeTurnId);
    }
    currentNativeTurnOwner = "foreground";
    return true;
  };

  const handleTurnCloseRecord = (
    nativeTurnId: string | null,
    record: Record<string, unknown>,
  ): void => {
    if (nativeTurnId !== null) {
      closedNativeTurnIds.add(nativeTurnId);
    }
    const matchesAutonomousTurn =
      autonomousTurn !== null &&
      (autonomousTurn.nativeTurnId === null ||
        nativeTurnId === null ||
        autonomousTurn.nativeTurnId === nativeTurnId);
    if (matchesAutonomousTurn && autonomousTurn) {
      closeAutonomousTurnFromRecord(autonomousTurn, record);
      return;
    }
    if (currentNativeTurnOwner === "foreground") {
      currentNativeTurnOwner = null;
    }
  };

  const processJournalLine = (line: string): void => {
    if (closed || runtimeExited) {
      return;
    }
    const parsed = parseMainKimiJournalRecord(line);
    if (!parsed) {
      return;
    }

    const { type } = parsed;
    if (applyBackgroundStateRecord(type, parsed)) {
      return;
    }

    const nativeTurnId = readKimiNativeTurnId(parsed);
    if (KIMI_TURN_CLOSE_TYPES.has(type)) {
      handleTurnCloseRecord(nativeTurnId, parsed);
      return;
    }
    if (nativeTurnId !== null && closedNativeTurnIds.has(nativeTurnId)) {
      return;
    }
    if (type === "agent.turn.started" || type === "turn.prompt") {
      if (!claimForegroundNativeTurn(nativeTurnId, false)) {
        openAutonomousTurn(nativeTurnId);
      }
      return;
    }
    if (type !== "context.append_loop_event" && type !== "llm.request") {
      return;
    }
    if (claimForegroundNativeTurn(nativeTurnId, true)) {
      return;
    }
    // Manual `/compact` writes `llm.request` inside `full_compaction.begin`..`.complete`
    // without `agent.turn.started` or `turn.ended`; keep that work under `compacting`
    // instead of opening a turn that has no turn-close record.
    if (type === "llm.request" && compacting && autonomousTurn === null) {
      return;
    }
    const turn = openAutonomousTurn(nativeTurnId);
    if (type === "context.append_loop_event") {
      emitAutonomousLoopEvent(turn, parsed.event);
    }
  };

  const consumeDecodedChunk = (decoded: string): void => {
    remainder += decoded;
    let newlineIndex = remainder.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = remainder.slice(0, newlineIndex);
      remainder = remainder.slice(newlineIndex + 1);
      if (skipPartialFirstLine) {
        skipPartialFirstLine = false;
      } else {
        processJournalLine(line);
      }
      newlineIndex = remainder.indexOf("\n");
    }
  };

  const drainJournal = async (immediateZero: boolean): Promise<void> => {
    if (closed || runtimeExited) {
      return;
    }
    try {
      const file = await open(journalPath, "r");
      try {
        const { size } = await file.stat();
        if (size < offset) {
          offset = 0;
          skipPartialFirstLine = false;
          remainder = "";
          decoder = new StringDecoder("utf8");
        }
        if (size > offset) {
          const buffer = Buffer.alloc(size - offset);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          offset += bytesRead;
          consumeDecodedChunk(decoder.write(buffer.subarray(0, bytesRead)));
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        context.logger.debug(
          { err: error, journalPath },
          "Failed reading Kimi native session journal",
        );
      }
    }
    reconcileBackgroundWorkCount(immediateZero);
  };

  const enqueueSync = (immediateZero = false): Promise<void> => {
    syncChain = syncChain
      .then(() => drainJournal(immediateZero))
      .catch((error) => {
        context.logger.debug({ err: error }, "Kimi native session monitor sync error");
      });
    return syncChain;
  };

  pollTimer = setInterval(() => {
    void enqueueSync(false);
  }, pollIntervalMs);
  pollTimer.unref?.();

  return {
    async syncBeforeForegroundTurnEnd(syncOptions?: { immediateZero?: boolean }): Promise<void> {
      await enqueueSync(syncOptions?.immediateZero ?? false);
    },
    hasActiveAutonomousTurn(): boolean {
      return autonomousTurn !== null;
    },
    onRuntimeExited({ code, signal, handledByForegroundTurn, diagnostic }): void {
      if (closed || runtimeExited) {
        return;
      }
      runtimeExited = true;
      clearAllTimers();
      const activeAutonomous = autonomousTurn;
      autonomousTurn = null;
      currentNativeTurnOwner = null;
      runningTaskIds.clear();
      activeGoal = false;
      compacting = false;

      if (emittedBackgroundWorkCount > 0) {
        emitBackgroundWorkCount(0);
      }
      if (!handledByForegroundTurn && activeAutonomous) {
        synthesizeCanceledAutonomousTools(activeAutonomous);
        context.emit({
          type: "turn_failed",
          provider: context.provider,
          error: `ACP agent exited unexpectedly (${code ?? "null"}${signal ? `, ${signal}` : ""})`,
          diagnostic,
          turnId: activeAutonomous.turnId,
        });
      }
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      clearAllTimers();
      await syncChain;
      autonomousTurn = null;
      currentNativeTurnOwner = null;
      runningTaskIds.clear();
      activeGoal = false;
      compacting = false;
      if (emittedBackgroundWorkCount > 0) {
        emitBackgroundWorkCount(0);
      }
    },
  };
}

interface KimiACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  journalPollIntervalMs?: number;
  backgroundZeroSettleMs?: number;
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
  readonly exclusiveSessionPersistence = true;

  constructor(options: KimiACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      commandsTransformer: transformKimiSlashCommands,
      promptBlocksTransformer: transformKimiPromptBlocks,
      outOfBandPromptHandler: handleKimiOutOfBandPrompt,
      catalogModelResolver: resolveKimiCatalogModels,
      promptResponseValidator: validateKimiPromptResponse,
      nativeTurnProbe: kimiNativeTurnStillOpen,
      nativeSessionMonitorFactory: (context) =>
        createKimiNativeSessionMonitor(context, {
          pollIntervalMs: options.journalPollIntervalMs,
          backgroundZeroSettleMs: options.backgroundZeroSettleMs,
        }),
    });
  }
}
