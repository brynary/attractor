import type { Usage } from "./response.js";

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
  FINISH: "finish",
  ERROR: "error",
  PROVIDER_EVENT: "provider_event",
} as const;

export type StreamEventType =
  (typeof StreamEventType)[keyof typeof StreamEventType];

export interface StreamStartEvent {
  type: typeof StreamEventType.STREAM_START;
  model?: string;
}

export interface TextStartEvent {
  type: typeof StreamEventType.TEXT_START;
}

export interface TextDeltaEvent {
  type: typeof StreamEventType.TEXT_DELTA;
  text: string;
}

export interface TextEndEvent {
  type: typeof StreamEventType.TEXT_END;
}

export interface ReasoningStartEvent {
  type: typeof StreamEventType.REASONING_START;
}

export interface ReasoningDeltaEvent {
  type: typeof StreamEventType.REASONING_DELTA;
  text: string;
}

export interface ReasoningEndEvent {
  type: typeof StreamEventType.REASONING_END;
  signature?: string;
}

export interface ToolCallStartEvent {
  type: typeof StreamEventType.TOOL_CALL_START;
  toolCallId: string;
  toolName: string;
}

export interface ToolCallDeltaEvent {
  type: typeof StreamEventType.TOOL_CALL_DELTA;
  toolCallId: string;
  argumentsDelta: string;
}

export interface ToolCallEndEvent {
  type: typeof StreamEventType.TOOL_CALL_END;
  toolCallId: string;
}

export interface FinishEvent {
  type: typeof StreamEventType.FINISH;
  finishReason: string;
  usage?: Usage;
}

export interface ErrorEvent {
  type: typeof StreamEventType.ERROR;
  error: Error;
}

export interface ProviderEvent {
  type: typeof StreamEventType.PROVIDER_EVENT;
  eventType: string;
  data: unknown;
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
  | FinishEvent
  | ErrorEvent
  | ProviderEvent;
