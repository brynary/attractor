import type { Message } from "./message.js";
import type { ToolDefinition, ToolChoice } from "./tool.js";
import type { ResponseFormat } from "./response-format.js";
import type { AdapterTimeout } from "./timeout.js";

export interface Request {
  /** Model identifier (e.g., "gpt-5.2", "claude-opus-4-6", "gemini-3-flash-preview") */
  model: string;
  /** Message history */
  messages: Message[];
  /** Provider name (defaults to client's default provider if not specified) */
  provider?: string;
  /** Tool definitions for function calling */
  tools?: ToolDefinition[];
  /** Tool choice strategy (defaults to "auto" when tools are provided) */
  toolChoice?: ToolChoice;
  /** Structured output format */
  responseFormat?: ResponseFormat;
  /** Sampling temperature (typically 0.0-1.0, defaults to provider's default) */
  temperature?: number;
  /** Top-p nucleus sampling (typically 0.0-1.0, defaults to provider's default) */
  topP?: number;
  /** Maximum output tokens (defaults to provider's default) */
  maxTokens?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Reasoning effort level for reasoning models (e.g., "low", "medium", "high") */
  reasoningEffort?: string;
  /** Metadata key-value pairs */
  metadata?: Record<string, string>;
  /** Provider-specific options escape hatch */
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Timeout configuration */
  timeout?: AdapterTimeout;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}
