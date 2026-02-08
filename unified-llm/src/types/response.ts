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

export namespace Usage {
  /**
   * Add two Usage objects together, summing all token counts.
   */
  export function add(a: Usage, b: Usage): Usage {
    return addUsage(a, b);
  }
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

export namespace Response {
  /**
   * Extract all text content from a response message.
   */
  export function text(response: Response): string {
    return responseText(response);
  }

  /**
   * Extract all tool calls from a response message.
   */
  export function toolCalls(response: Response): ToolCallData[] {
    return responseToolCalls(response);
  }

  /**
   * Extract reasoning/thinking content from a response message.
   */
  export function reasoning(response: Response): string | undefined {
    return responseReasoning(response);
  }
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
    raw: b.raw ?? a.raw,
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

export function responseReasoning(response: Response): string | undefined {
  const parts = response.message.content.filter(isThinkingPart);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.map((part) => part.thinking.text).join("");
}
