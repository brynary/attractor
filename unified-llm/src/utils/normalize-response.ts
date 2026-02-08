/**
 * Response normalization utilities for converting provider-specific responses
 * to unified format.
 */

import type { Usage } from "../types/response.js";

/**
 * Standard finish reason types across providers.
 */
export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error" | "other";

/**
 * Maps provider-specific finish reasons to standardized reasons.
 * Used by response translators to normalize stop reasons.
 */
export function mapFinishReason(
  providerReason: string,
  hasToolCalls: boolean,
  provider: "anthropic" | "openai" | "gemini" | "openai_compatible",
): FinishReason {
  switch (provider) {
    case "anthropic":
      switch (providerReason) {
        case "end_turn":
        case "stop_sequence":
          return "stop";
        case "max_tokens":
          return "length";
        case "tool_use":
          return "tool_calls";
        default:
          return "other";
      }

    case "openai":
      switch (providerReason) {
        case "completed":
          return hasToolCalls ? "tool_calls" : "stop";
        case "incomplete":
          return "length";
        case "failed":
          return "error";
        case "content_filter":
          return "content_filter";
        default:
          return "other";
      }

    case "gemini":
      switch (providerReason) {
        case "STOP":
          return hasToolCalls ? "tool_calls" : "stop";
        case "MAX_TOKENS":
          return "length";
        case "SAFETY":
        case "RECITATION":
          return "content_filter";
        default:
          return hasToolCalls ? "tool_calls" : "other";
      }

    case "openai_compatible":
      switch (providerReason) {
        case "stop":
          return hasToolCalls ? "tool_calls" : "stop";
        case "length":
          return "length";
        case "tool_calls":
          return "tool_calls";
        case "content_filter":
          return "content_filter";
        default:
          return "other";
      }
  }
}

/**
 * Constructs a normalized Usage object from raw provider usage data.
 * Handles common patterns like input/output/total tokens and optional fields.
 */
export function normalizeUsage(
  inputTokens: number,
  outputTokens: number,
  options?: {
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    raw?: Record<string, unknown>;
  },
): Usage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens: options?.reasoningTokens,
    cacheReadTokens: options?.cacheReadTokens,
    cacheWriteTokens: options?.cacheWriteTokens,
    raw: options?.raw,
  };
}

/**
 * Estimates reasoning tokens from word count for providers that don't report them.
 * Uses a 1.3x multiplier as a rough approximation.
 */
export function estimateReasoningTokens(thinkingText: string): number {
  const wordCount = thinkingText.split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}
