import type { Message } from "./message.js";
import type { ToolCallData } from "./content-part.js";
import { isTextPart, isToolCallPart, isThinkingPart } from "./content-part.js";

export interface FinishReason {
  reason:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "error"
    | "other";
  raw?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  raw?: Record<string, unknown>;
}

export interface Warning {
  message: string;
  code?: string;
}

export interface RateLimitInfo {
  requestsRemaining?: number;
  requestsLimit?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  resetAt?: Date;
}

export interface Response {
  id: string;
  model: string;
  provider: string;
  message: Message;
  finishReason: FinishReason;
  usage: Usage;
  raw?: Record<string, unknown>;
  warnings: Warning[];
  rateLimit?: RateLimitInfo;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    reasoningTokens:
      a.reasoningTokens !== undefined || b.reasoningTokens !== undefined
        ? (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0)
        : undefined,
    cacheReadTokens:
      a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined
        ? (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0)
        : undefined,
    cacheWriteTokens:
      a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined
        ? (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0)
        : undefined,
  };
}

export function responseText(response: Response): string {
  return response.message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

export function responseToolCalls(response: Response): ToolCallData[] {
  return response.message.content
    .filter(isToolCallPart)
    .map((part) => part.toolCall);
}

export function responseReasoning(response: Response): string {
  return response.message.content
    .filter(isThinkingPart)
    .map((part) => part.thinking.text)
    .join("");
}
