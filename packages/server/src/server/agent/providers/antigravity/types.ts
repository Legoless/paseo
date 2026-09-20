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

export interface AgyStepUpdatePayload {
  conversation_id: string;
  step_index: number;
  state: "RUNNING" | "DONE" | "ERROR";
  step_type: string;
  content?: unknown;
  usage?: AgyUsage;
  [key: string]: unknown;
}

export interface AgyStepUpdateEvent {
  event: "step_update";
  step_update: AgyStepUpdatePayload;
}

export interface AgyResultPayload {
  conversation_id: string;
  status: "SUCCESS" | "ERROR";
  response: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
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
  content: AgyStreamInputContentBlock[];
}

export interface AgyStreamInputMessage {
  event: "user";
  message: AgyStreamInputUserMessage;
}
