import type { FinishReason, Usage, Response, Warning } from "./response.js";
import type { SDKError } from "./errors.js";

export const StreamEventType = {
  STREAM_START: "stream_start",
  TEXT_START: "text_start",
  TEXT_DELTA: "text_delta",
  TEXT_END: "text_end",
  REASONING_START: "reasoning_start",
  REASONING_DELTA: "reasoning_delta",
  REASONING_END: "reasoning_end",
  TOOL_CALL_START: "tool_call_start",
  TOOL_CALL_DELTA: "tool_call_delta",
  TOOL_CALL_END: "tool_call_end",
  STEP_FINISH: "step_finish",
  FINISH: "finish",
  ERROR: "error",
  PROVIDER_EVENT: "provider_event",
} as const;

export type StreamEventType =
  (typeof StreamEventType)[keyof typeof StreamEventType];

export interface StreamStartEvent {
  type: typeof StreamEventType.STREAM_START;
  id?: string;
  model?: string;
  warnings?: Warning[];
  raw?: unknown;
}

export interface TextStartEvent {
  type: typeof StreamEventType.TEXT_START;
  textId?: string;
  raw?: unknown;
}

export interface TextDeltaEvent {
  type: typeof StreamEventType.TEXT_DELTA;
  delta: string;
  textId?: string;
  raw?: unknown;
}

export interface TextEndEvent {
  type: typeof StreamEventType.TEXT_END;
  textId?: string;
  raw?: unknown;
}

export interface ReasoningStartEvent {
  type: typeof StreamEventType.REASONING_START;
  reasoningId?: string;
  raw?: unknown;
}

export interface ReasoningDeltaEvent {
  type: typeof StreamEventType.REASONING_DELTA;
  reasoningDelta: string;
  reasoningId?: string;
  /** True when the delta comes from a redacted reasoning block. */
  redacted?: boolean;
  raw?: unknown;
}

export interface ReasoningEndEvent {
  type: typeof StreamEventType.REASONING_END;
  reasoningId?: string;
  signature?: string;
  raw?: unknown;
}

export interface ToolCallStartEvent {
  type: typeof StreamEventType.TOOL_CALL_START;
  toolCallId: string;
  toolName: string;
  raw?: unknown;
}

export interface ToolCallDeltaEvent {
  type: typeof StreamEventType.TOOL_CALL_DELTA;
  toolCallId: string;
  argumentsDelta: string;
  raw?: unknown;
}

export interface ToolCallEndEvent {
  type: typeof StreamEventType.TOOL_CALL_END;
  toolCallId: string;
  raw?: unknown;
}

export interface StepFinishEvent {
  type: typeof StreamEventType.STEP_FINISH;
  finishReason: FinishReason;
  usage?: Usage;
  raw?: unknown;
}

export interface FinishEvent {
  type: typeof StreamEventType.FINISH;
  finishReason: FinishReason;
  usage?: Usage;
  response?: Response;
  raw?: unknown;
}

export interface ErrorEvent {
  type: typeof StreamEventType.ERROR;
  error: SDKError;
  raw?: unknown;
}

export interface ProviderEvent {
  type: typeof StreamEventType.PROVIDER_EVENT;
  eventType: string;
  raw: unknown;
}

export type StreamEvent =
  | StreamStartEvent
  | TextStartEvent
  | TextDeltaEvent
  | TextEndEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallEndEvent
  | StepFinishEvent
  | FinishEvent
  | ErrorEvent
  | ProviderEvent;
