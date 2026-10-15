import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ProviderLaunch,
  ProviderSessionConfig,
  ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import { toolItem } from "./timeline.js";
import type { Step } from "./wire.js";

type ToolParameters = NonNullable<Step["tool_info"]>["parameters"];

interface TranscriptToolCall {
  id?: string;
  name?: string;
  args?: ToolParameters;
  output?: string;
  error?: string;
}

interface TranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: TranscriptToolCall[];
  truncated_fields?: string[];
}

export interface ReplayedTranscriptEntry {
  item: ProviderTimelineItem;
  timestamp?: string;
}

const USER_REQUEST_MATCH = /^<USER_REQUEST>\r?\n?([\s\S]*?)\r?\n?<\/USER_REQUEST>/;

function resolveTranscriptDirectory(
  conversationId: string,
  config: ProviderSessionConfig,
  launch: ProviderLaunch,
): string {
  const home = config.env.HOME || launch.env?.HOME || process.env.HOME || os.homedir();
  return path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
  );
}

function parseJsonlSteps(raw: string): TranscriptStep[] {
  const steps: TranscriptStep[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      steps.push(JSON.parse(trimmed) as TranscriptStep);
    } catch {
      // Ignore malformed trailing lines.
    }
  }
  return steps;
}

function extractUserMessageText(
  raw: string,
  systemPrompt: string | undefined,
  isFirstUserMessage: boolean,
): string {
  const match = raw.match(USER_REQUEST_MATCH);
  let text = match ? match[1] : raw;
  if (isFirstUserMessage && systemPrompt && text.startsWith(`${systemPrompt}\n\n`)) {
    text = text.slice(systemPrompt.length + 2);
  }
  return text;
}

function normalizeToolParameters(args: ToolParameters | undefined): ToolParameters {
  if (!args) return {};
  const result: ToolParameters = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      try {
        result[key] = JSON.parse(value) as ToolParameters[string];
        continue;
      } catch {
        // Keep raw string when not JSON-encoded.
      }
    }
    result[key] = value;
  }
  return result;
}

function isTruncatedContentStep(step: TranscriptStep): boolean {
  return (
    (step.type === "USER_INPUT" || step.type === "PLANNER_RESPONSE") &&
    Array.isArray(step.truncated_fields) &&
    step.truncated_fields.includes("content")
  );
}

async function hydrateTruncatedStepContent(
  logsDir: string,
  steps: TranscriptStep[],
): Promise<void> {
  if (!steps.some(isTruncatedContentStep)) return;
  try {
    const fullRaw = await readFile(path.join(logsDir, "transcript_full.jsonl"), "utf8");
    const fullByIndex = new Map<number, TranscriptStep>();
    for (const fullStep of parseJsonlSteps(fullRaw)) {
      if (typeof fullStep.step_index === "number") {
        fullByIndex.set(fullStep.step_index, fullStep);
      }
    }
    for (const step of steps) {
      if (typeof step.step_index === "number" && isTruncatedContentStep(step)) {
        const fullStep = fullByIndex.get(step.step_index);
        if (typeof fullStep?.content === "string") {
          step.content = fullStep.content;
        }
      }
    }
  } catch {
    // Keep compact transcript content if transcript_full.jsonl is unavailable.
  }
}

function resolveToolError(
  step: TranscriptStep,
  call: TranscriptToolCall | undefined,
  responseStep: TranscriptStep | undefined,
  responseOutput: string,
): { message: string; type: string } | null {
  if (typeof call?.error === "string") {
    return { message: call.error, type: "ERROR" };
  }
  if (step.status === "ERROR" || responseStep?.status === "ERROR") {
    return { message: responseOutput || "Antigravity tool failed", type: "ERROR" };
  }
  return null;
}

function buildToolCallEntry(
  conversationId: string,
  step: TranscriptStep,
  stepIndex: number,
  call: TranscriptToolCall | undefined,
  callIndex: number,
  responseStep: TranscriptStep | undefined,
  timestamp: string | undefined,
): ReplayedTranscriptEntry {
  const toolName = call?.name || "tool";
  const id = call?.id || `${conversationId}:tool:${stepIndex}:${callIndex}`;
  const responseOutput =
    responseStep?.type === "GENERIC" && typeof responseStep.content === "string"
      ? responseStep.content
      : "";
  const error = resolveToolError(step, call, responseStep, responseOutput);
  const syntheticStep: Step = {
    conversation_id: conversationId,
    step_index: stepIndex,
    step_type: "tool",
    state: error ? "ERROR" : "DONE",
    text_delta: "",
    tool_name: toolName,
    tool_info: {
      name: toolName,
      parameters: normalizeToolParameters(call?.args),
      output: call?.output ?? responseOutput,
      error,
    },
    subagent_info: null,
    usage: null,
  };
  return {
    item: toolItem(syntheticStep, id),
    timestamp,
  };
}

function appendPlannerResponseEntries(
  entries: ReplayedTranscriptEntry[],
  conversationId: string,
  steps: TranscriptStep[],
  index: number,
  stepIndex: number,
  timestamp: string | undefined,
): void {
  const step = steps[index];
  if (typeof step.thinking === "string" && step.thinking.trim().length > 0) {
    entries.push({
      item: {
        type: "reasoning",
        id: `${conversationId}:reasoning:${stepIndex}`,
        text: step.thinking,
      },
      timestamp,
    });
  }
  if (Array.isArray(step.tool_calls)) {
    for (let callIndex = 0; callIndex < step.tool_calls.length; callIndex += 1) {
      entries.push(
        buildToolCallEntry(
          conversationId,
          step,
          stepIndex,
          step.tool_calls[callIndex],
          callIndex,
          steps[index + 1 + callIndex],
          timestamp,
        ),
      );
    }
  }
  if (typeof step.content === "string" && step.content.trim().length > 0) {
    const id = `${conversationId}:assistant:${stepIndex}`;
    entries.push({
      item: {
        type: "assistant_message",
        id,
        messageId: id,
        text: step.content,
      },
      timestamp,
    });
  }
}

export async function readTranscriptItems(
  conversationId: string,
  config: ProviderSessionConfig,
  launch: ProviderLaunch,
): Promise<ReplayedTranscriptEntry[]> {
  const logsDir = resolveTranscriptDirectory(conversationId, config, launch);
  let raw: string;
  try {
    raw = await readFile(path.join(logsDir, "transcript.jsonl"), "utf8");
  } catch {
    return [];
  }

  const steps = parseJsonlSteps(raw);
  await hydrateTruncatedStepContent(logsDir, steps);

  const entries: ReplayedTranscriptEntry[] = [];
  let seenFirstUserMessage = false;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepIndex = typeof step.step_index === "number" ? step.step_index : index;
    const timestamp = typeof step.created_at === "string" ? step.created_at : undefined;

    if (step.type === "USER_INPUT") {
      if (typeof step.content === "string") {
        const text = extractUserMessageText(
          step.content,
          config.systemPrompt,
          !seenFirstUserMessage,
        );
        seenFirstUserMessage = true;
        if (text.trim().length > 0) {
          const id = `${conversationId}:user:${stepIndex}`;
          entries.push({
            item: { type: "user_message", id, messageId: id, text },
            timestamp,
          });
        }
      }
      continue;
    }

    if (step.type === "PLANNER_RESPONSE") {
      appendPlannerResponseEntries(entries, conversationId, steps, index, stepIndex, timestamp);
    }
  }

  return entries;
}
