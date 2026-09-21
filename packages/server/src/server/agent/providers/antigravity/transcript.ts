import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

import type { AgentStreamEvent, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { mapAgyToolDetail } from "./stream-decoder.js";
import type { AgyToolInfo } from "./types.js";

export interface AgyTranscriptToolCall {
  name?: string;
  args?: Record<string, unknown>;
}

export interface AgyTranscriptStep {
  step_index: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: AgyTranscriptToolCall[];
}

const USER_REQUEST_PATTERN = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/;

export function extractAgyUserRequest(content: string): string {
  const match = USER_REQUEST_PATTERN.exec(content);
  if (match) return match[1].trim();
  return content.trim();
}

export function convertAgyTranscriptSteps(
  provider: string,
  steps: AgyTranscriptStep[],
): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  let pendingTool: { callId: string; name: string; args: Record<string, unknown> } | null = null;

  for (const step of steps) {
    const timestamp = typeof step.created_at === "string" ? step.created_at : undefined;
    if (step.type === "USER_INPUT" && typeof step.content === "string") {
      flushPendingTool(events, provider, pendingTool, undefined, timestamp);
      pendingTool = null;
      const text = extractAgyUserRequest(step.content);
      if (text.length > 0) {
        events.push({
          type: "timeline",
          item: { type: "user_message", text },
          provider,
          timestamp,
        });
      }
      continue;
    }

    if (step.type === "SYSTEM_MESSAGE") {
      continue;
    }

    if (typeof step.thinking === "string" && step.thinking.trim().length > 0) {
      events.push({
        type: "timeline",
        item: { type: "reasoning", text: step.thinking },
        provider,
        timestamp,
      });
    }

    if (step.tool_calls && step.tool_calls.length > 0) {
      flushPendingTool(events, provider, pendingTool, undefined, timestamp);
      const tool = step.tool_calls[0];
      const name = tool.name ?? "tool";
      const args = coerceToolArgs(tool.args);
      pendingTool = { callId: String(step.step_index), name, args };
      events.push(toolEvent(provider, pendingTool, "running", undefined, timestamp));
      continue;
    }

    if (typeof step.content === "string" && step.content.length > 0) {
      if (pendingTool && step.type === "GENERIC") {
        flushPendingTool(events, provider, pendingTool, step.content, timestamp);
        pendingTool = null;
        continue;
      }
      events.push({
        type: "timeline",
        item: { type: "assistant_message", text: step.content },
        provider,
        timestamp,
      });
    }
  }

  flushPendingTool(events, provider, pendingTool, undefined, undefined);
  return events;
}

export async function* streamAgyTranscriptHistory(
  provider: string,
  transcriptPath: string,
): AsyncGenerator<AgentStreamEvent> {
  if (!existsSync(transcriptPath)) return;
  const steps: AgyTranscriptStep[] = [];
  const reader = createInterface({
    input: createReadStream(transcriptPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      steps.push(JSON.parse(trimmed) as AgyTranscriptStep);
    } catch {
      // Skip malformed transcript lines.
    }
  }
  yield* convertAgyTranscriptSteps(provider, steps);
}

function coerceToolArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    next[key] = coerceToolArg(value);
  }
  return next;
}

function coerceToolArg(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function flushPendingTool(
  events: AgentStreamEvent[],
  provider: string,
  pending: { callId: string; name: string; args: Record<string, unknown> } | null,
  output: string | undefined,
  timestamp: string | undefined,
): void {
  if (!pending) return;
  events.push(toolEvent(provider, pending, "completed", output, timestamp));
}

function toolEvent(
  provider: string,
  pending: { callId: string; name: string; args: Record<string, unknown> },
  status: "running" | "completed",
  output: string | undefined,
  timestamp: string | undefined,
): AgentStreamEvent {
  const toolInfo: AgyToolInfo = {
    name: pending.name,
    parameters: pending.args,
    ...(output === undefined ? {} : { output }),
  };
  return {
    type: "timeline",
    item: {
      type: "tool_call",
      callId: pending.callId,
      name: pending.name,
      status,
      error: null,
      detail: mapAgyToolDetail(pending.name, toolInfo),
    } as ToolCallTimelineItem,
    provider,
    timestamp,
  };
}
