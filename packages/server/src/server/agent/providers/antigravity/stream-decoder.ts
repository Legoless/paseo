import type {
  AgentPermissionRequest,
  AgentStreamEvent,
  AgentUsage,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import type {
  AgyDeniedAction,
  AgyResultPayload,
  AgyStepUpdatePayload,
  AgyStreamEvent,
  AgyToolInfo,
  AgyUsage,
} from "./types.js";

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

function extractReasoningDelta(rawStep: Record<string, unknown>): string {
  if (typeof rawStep.thinking_delta === "string") return rawStep.thinking_delta;
  if (typeof rawStep.thought === "string") return rawStep.thought;
  if (typeof rawStep.reasoning === "string") return rawStep.reasoning;
  return "";
}

function extractToolError(toolInfo?: AgyToolInfo, rawStep?: Record<string, unknown>): unknown {
  const errObj = toolInfo?.error ?? rawStep?.error;
  if (typeof errObj === "object" && errObj !== null && "message" in errObj) {
    return String((errObj as { message: unknown }).message);
  }
  if (typeof errObj === "string") {
    return errObj;
  }
  return "Tool execution failed";
}

function extractPlainTextDetail(toolInfo?: AgyToolInfo, content?: unknown): string | undefined {
  if (toolInfo?.parameters !== undefined) {
    return JSON.stringify(toolInfo.parameters);
  }
  if (
    content !== undefined &&
    typeof content === "object" &&
    content !== null &&
    Object.keys(content).length > 0
  ) {
    return JSON.stringify(content);
  }
  return undefined;
}

function mapShellDetail(params: Record<string, unknown>, output?: string): ToolCallDetail {
  const command = String(params.CommandLine ?? params.command ?? params.cmd ?? "");
  return {
    type: "shell",
    command,
    output,
  };
}

function mapReadDetail(params: Record<string, unknown>, output?: string): ToolCallDetail {
  const filePath = String(params.AbsolutePath ?? params.path ?? params.filePath ?? "");
  return {
    type: "read",
    filePath,
    content: output,
  };
}

function mapWriteDetail(params: Record<string, unknown>): ToolCallDetail {
  const filePath = String(params.TargetFile ?? params.path ?? params.filePath ?? "");
  const content = typeof params.CodeContent === "string" ? params.CodeContent : undefined;
  return {
    type: "write",
    filePath,
    content,
  };
}

function mapEditDetail(params: Record<string, unknown>): ToolCallDetail {
  const filePath = String(params.TargetFile ?? params.path ?? params.filePath ?? "");
  return {
    type: "edit",
    filePath,
    oldString: typeof params.TargetContent === "string" ? params.TargetContent : undefined,
    newString:
      typeof params.ReplacementContent === "string" ? params.ReplacementContent : undefined,
  };
}

export function mapAgyDeniedAction(
  provider: string,
  action: AgyDeniedAction,
  index: number,
  turnId?: string,
): AgentPermissionRequest {
  return {
    id: `agy-denied-${turnId ?? "result"}-${index}`,
    provider,
    name: action.action,
    kind: "tool",
    title: action.display_name,
    description:
      "Antigravity denied this tool in headless mode. Allow switches this session to Bypass so the next turn can run it.",
    actions: [
      { id: "bypass", label: "Bypass", behavior: "allow", variant: "danger" },
      { id: "dismiss", label: "Dismiss", behavior: "deny", variant: "secondary" },
    ],
  };
}

export function mapAgyToolDetail(
  toolName: string,
  toolInfo?: AgyToolInfo,
  content?: unknown,
): ToolCallDetail {
  const params = (toolInfo?.parameters ?? content ?? {}) as Record<string, unknown>;
  const output = typeof toolInfo?.output === "string" ? toolInfo.output : undefined;

  switch (toolName) {
    case "run_command":
    case "bash":
    case "execute_command":
      return mapShellDetail(params, output);
    case "view_file":
    case "read_file":
      return mapReadDetail(params, output);
    case "write_to_file":
      return mapWriteDetail(params);
    case "replace_file_content":
      return mapEditDetail(params);
    default:
      return {
        type: "plain_text",
        label: toolName,
        text: extractPlainTextDetail(toolInfo, content),
      };
  }
}

// agy retries a transient API failure itself ("API error (attempt 1): INTERNAL (code 500)…"),
// but its long-lived process then reports that error on the result of the turn and of every
// later turn, even ones that finished. A final response means the turn completed.
const RETRIED_API_ERROR = /^API error \(attempt \d+\):/;

function isRecoveredApiErrorResult(result: AgyResultPayload): boolean {
  return (
    result.status === "ERROR" &&
    RETRIED_API_ERROR.test(result.error ?? "") &&
    result.response.trim().length > 0
  );
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

  private handleAssistantStep(
    step: AgyStepUpdatePayload,
    rawStep: Record<string, unknown>,
    turnId?: string,
  ): void {
    const textDelta = typeof rawStep.text_delta === "string" ? rawStep.text_delta : "";
    const text = textDelta.length > 0 ? textDelta : extractStepText(step.content);
    if (text.length === 0) return;

    this.emittedAssistantText += text;
    const messageId = turnId ? `${turnId}-${step.step_index}` : `agy-${step.step_index}`;
    this.onEvent({
      type: "timeline",
      item: {
        type: "assistant_message",
        text,
        messageId,
      },
      provider: this.provider,
      turnId,
    });
  }

  private handleToolStep(
    step: AgyStepUpdatePayload,
    rawStep: Record<string, unknown>,
    turnId?: string,
  ): void {
    const callId = String(step.step_index);
    const toolInfo = (rawStep.tool_info ?? {}) as AgyToolInfo;
    const toolName = String(step.tool_name || toolInfo.name || rawStep.name || "tool");

    let status: "running" | "completed" | "failed" = "running";
    let error: unknown = null;
    if (step.state === "DONE") {
      status = "completed";
    } else if (step.state === "ERROR") {
      status = "failed";
      error = extractToolError(toolInfo, rawStep);
    }

    const detail = mapAgyToolDetail(toolName, toolInfo, step.content);

    this.onEvent({
      type: "timeline",
      item: {
        type: "tool_call",
        callId,
        name: toolName,
        status,
        error,
        detail,
      } as ToolCallTimelineItem,
      provider: this.provider,
      turnId,
    });
  }

  private handleStepUpdate(step: AgyStepUpdatePayload, turnId?: string): void {
    const rawStep = step as Record<string, unknown>;
    const reasoningDelta = extractReasoningDelta(rawStep);

    if (reasoningDelta.length > 0) {
      this.onEvent({
        type: "timeline",
        item: {
          type: "reasoning",
          text: reasoningDelta,
        },
        provider: this.provider,
        turnId,
      });
    }

    if (step.step_type === "agent_response" || step.step_type === "planner_response") {
      this.handleAssistantStep(step, rawStep, turnId);
    } else if (
      step.step_type === "tool" ||
      step.step_type === "tool_call" ||
      step.step_type === "call"
    ) {
      this.handleToolStep(step, rawStep, turnId);
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
      let missingText = "";
      if (result.response.startsWith(this.emittedAssistantText)) {
        missingText = result.response.slice(this.emittedAssistantText.length);
      } else if (this.emittedAssistantText.length === 0) {
        missingText = result.response;
      }

      if (missingText.length > 0) {
        this.emittedAssistantText += missingText;
        this.onEvent({
          type: "timeline",
          item: {
            type: "assistant_message",
            text: missingText,
          },
          provider: this.provider,
          turnId,
        });
      }
    }

    if (usage) {
      this.onEvent({
        type: "usage_updated",
        provider: this.provider,
        usage,
        turnId,
      });
    }

    if (result.denied_actions) {
      for (const [index, action] of result.denied_actions.entries()) {
        this.onEvent({
          type: "permission_requested",
          provider: this.provider,
          request: mapAgyDeniedAction(this.provider, action, index, turnId),
          turnId,
        });
      }
    }

    if (result.status === "SUCCESS" || isRecoveredApiErrorResult(result)) {
      this.onEvent({
        type: "turn_completed",
        provider: this.provider,
        usage,
        turnId,
      });
      return;
    }

    if (result.status === "CANCELED" || result.status === "INTERRUPTED") {
      this.onEvent({
        type: "turn_canceled",
        provider: this.provider,
        reason: result.error || "Interrupted by user",
        turnId,
      });
      return;
    }

    if (turnId) {
      this.onEvent({
        type: "turn_failed",
        provider: this.provider,
        error: result.error || "Antigravity execution failed",
        turnId,
      });
    }
  }
}
