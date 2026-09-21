export interface AgyInitPayload {
  cwd: string;
  tools?: string[];
  permission_mode?: string;
}

export interface AgyInitEvent {
  event: "init";
  conversation_id: string;
  init: AgyInitPayload;
}

export interface AgyUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens: number;
}

export interface AgyToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  output?: string;
  error?:
    | {
        type?: string;
        message?: string;
        [key: string]: unknown;
      }
    | string;
  [key: string]: unknown;
}

export interface AgyStepUpdatePayload {
  conversation_id: string;
  step_index: number;
  state: "RUNNING" | "ACTIVE" | "DONE" | "ERROR";
  step_type: string;
  text_delta?: string;
  thinking_delta?: string;
  thought?: string;
  reasoning?: string;
  tool_name?: string;
  tool_info?: AgyToolInfo;
  content?: unknown;
  usage?: AgyUsage;
  [key: string]: unknown;
}

export interface AgyStepUpdateEvent {
  event: "step_update";
  step_update: AgyStepUpdatePayload;
}

export type AgyResultStatus =
  | "SUCCESS"
  | "ERROR"
  | "CANCELED"
  | "INTERRUPTED"
  | "INVALID"
  | "WAITING"
  | "RUNNING";

export interface AgyDeniedAction {
  action: string;
  display_name: string;
}

export interface AgyResultPayload {
  conversation_id: string;
  status: AgyResultStatus;
  response: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
  denied_actions?: AgyDeniedAction[];
}

export interface AgyResultEvent {
  event: "result";
  result: AgyResultPayload;
}

export interface AgyGenericEvent {
  event: string;
  conversation_id?: string;
  step_update?: AgyStepUpdatePayload;
  result?: AgyResultPayload;
  init?: AgyInitPayload;
  [key: string]: unknown;
}

export type AgyStreamEvent = AgyInitEvent | AgyStepUpdateEvent | AgyResultEvent | AgyGenericEvent;

export interface AgyStreamInputContentBlock {
  type: "text";
  text: string;
}

export interface AgyStreamInputUserMessage {
  content: string | AgyStreamInputContentBlock[];
}

export interface AgyStreamInputMessage {
  event: "user";
  message: AgyStreamInputUserMessage;
}
