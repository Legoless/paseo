import type { AgentStreamEvent, AgentUsage } from "../../agent-sdk-types.js";
import type { AgyResultPayload, AgyStepUpdatePayload, AgyStreamEvent, AgyUsage } from "./types.js";

export function mapAgyUsage(usage?: AgyUsage): AgentUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cache_read_tokens,
    outputTokens: usage.output_tokens,
  };
}

export function extractStepText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  const record = content as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.response === "string") return record.response;
  if (Array.isArray(record.parts)) {
    return record.parts
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export class AntigravityStreamDecoder {
  private lineBuffer = "";
  private emittedAssistantText = "";

  constructor(
    private readonly provider: string,
    private readonly onEvent: (event: AgentStreamEvent) => void,
    private readonly onInit?: (conversationId: string) => void,
  ) {}

  resetTurn(): void {
    this.emittedAssistantText = "";
  }

  write(chunk: string, turnId?: string): void {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.parseLine(line, turnId);
      }
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  flush(turnId?: string): void {
    const line = this.lineBuffer.trim();
    this.lineBuffer = "";
    if (line.length > 0) {
      this.parseLine(line, turnId);
    }
  }

  private parseLine(line: string, turnId?: string): void {
    if (!line.startsWith("{")) {
      return;
    }
    try {
      const parsed = JSON.parse(line) as AgyStreamEvent;
      this.handleParsedEvent(parsed, turnId);
    } catch {
      // Ignore malformed or partial output lines
    }
  }

  private handleParsedEvent(event: AgyStreamEvent, turnId?: string): void {
    if (event.event === "init" && event.conversation_id) {
      this.onInit?.(event.conversation_id);
      this.onEvent({
        type: "thread_started",
        sessionId: event.conversation_id,
        provider: this.provider,
      });
      return;
    }

    if (event.event === "step_update" && event.step_update) {
      this.handleStepUpdate(event.step_update, turnId);
      return;
    }

    if (event.event === "result" && event.result) {
      this.handleResult(event.result, turnId);
      return;
    }
  }

  private handleStepUpdate(step: AgyStepUpdatePayload, turnId?: string): void {
    const rawStep = step as Record<string, unknown>;
    const textDelta = typeof rawStep.text_delta === "string" ? rawStep.text_delta : "";

    if (step.step_type === "agent_response" || step.step_type === "planner_response") {
      const text = textDelta.length > 0 ? textDelta : extractStepText(step.content);
      if (text.length > 0) {
        this.emittedAssistantText += text;
        this.onEvent({
          type: "timeline",
          item: {
            type: "assistant_message",
            text,
          },
          provider: this.provider,
          turnId,
        });
      }
    } else if (step.step_type === "tool_call" || step.step_type === "call") {
      const callId = String(step.step_index);
      const toolName = String(
        (step as Record<string, unknown>).tool_name ||
          (step as Record<string, unknown>).name ||
          "tool",
      );
      this.onEvent({
        type: "timeline",
        item: {
          type: "tool_call",
          callId,
          name: toolName,
          status: step.state === "DONE" ? "completed" : "running",
          error: null,
          detail: {
            type: "plain_text",
            label: toolName,
            text: JSON.stringify(step.content || {}),
          },
        },
        provider: this.provider,
        turnId,
      });
    }

    if (step.usage) {
      const usage = mapAgyUsage(step.usage);
      if (usage) {
        this.onEvent({
          type: "usage_updated",
          provider: this.provider,
          usage,
          turnId,
        });
      }
    }
  }

  private handleResult(result: AgyResultPayload, turnId?: string): void {
    const usage = mapAgyUsage(result.usage);

    if (result.response && result.response !== this.emittedAssistantText) {
      this.emittedAssistantText = result.response;
      this.onEvent({
        type: "timeline",
        item: {
          type: "assistant_message",
          text: result.response,
        },
        provider: this.provider,
        turnId,
      });
    }

    if (usage) {
      this.onEvent({
        type: "usage_updated",
        provider: this.provider,
        usage,
        turnId,
      });
    }

    if (result.status === "SUCCESS") {
      this.onEvent({
        type: "turn_completed",
        provider: this.provider,
        usage,
        turnId,
      });
    } else {
      this.onEvent({
        type: "turn_failed",
        provider: this.provider,
        error: result.error || "Antigravity execution failed",
        turnId,
      });
    }
  }
}
