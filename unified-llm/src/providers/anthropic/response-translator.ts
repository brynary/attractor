import type { Response, Usage, RateLimitInfo } from "../../types/response.js";
import type { ContentPart } from "../../types/content-part.js";
import type { Message } from "../../types/message.js";
import { Role } from "../../types/role.js";
import { str, num, optNum, optStr, rec, recArray, recOrEmpty } from "../../utils/extract.js";
import { mapFinishReason, normalizeUsage, estimateReasoningTokens } from "../../utils/normalize-response.js";

function translateContentBlock(block: Record<string, unknown>): ContentPart | undefined {
  switch (block["type"]) {
    case "text":
      return { kind: "text", text: str(block["text"]) };
    case "tool_use":
      return {
        kind: "tool_call",
        toolCall: {
          id: str(block["id"]),
          name: str(block["name"]),
          arguments: recOrEmpty(block["input"]),
          rawArguments: JSON.stringify(block["input"] ?? {}),
        },
      };
    case "thinking":
      return {
        kind: "thinking",
        thinking: {
          text: str(block["thinking"]),
          signature: optStr(block["signature"]),
          redacted: false,
        },
      };
    case "redacted_thinking":
      return {
        kind: "redacted_thinking",
        thinking: {
          text: str(block["data"]),
          redacted: true,
        },
      };
    default:
      return undefined;
  }
}

export function translateResponse(
  body: Record<string, unknown>,
  rateLimit?: RateLimitInfo,
): Response {
  const content = recArray(body["content"]);
  const usageData = rec(body["usage"]);

  const parts: ContentPart[] = [];
  for (const block of content) {
    const translated = translateContentBlock(block);
    if (translated) {
      parts.push(translated);
    }
  }

  let totalReasoningTokens = 0;
  for (const part of parts) {
    if (part.kind === "thinking") {
      totalReasoningTokens += estimateReasoningTokens(part.thinking.text);
    }
  }

  const stopReason = str(body["stop_reason"]);

  const inputTokens = num(usageData?.["input_tokens"]);
  const outputTokens = num(usageData?.["output_tokens"]);
  const cacheReadTokens = optNum(usageData?.["cache_read_input_tokens"]);
  const cacheWriteTokens = optNum(usageData?.["cache_creation_input_tokens"]);

  const usage = normalizeUsage(inputTokens, outputTokens, {
    reasoningTokens: totalReasoningTokens > 0 ? totalReasoningTokens : undefined,
    cacheReadTokens,
    cacheWriteTokens,
    raw: usageData,
  });

  const message: Message = {
    role: Role.ASSISTANT,
    content: parts,
  };

  const hasToolCalls = parts.some((p) => p.kind === "tool_call");

  return {
    id: str(body["id"]),
    model: str(body["model"]),
    provider: "anthropic",
    message,
    finishReason: {
      reason: mapFinishReason(stopReason, hasToolCalls, "anthropic"),
      raw: stopReason,
    },
    usage,
    raw: body,
    warnings: [],
    rateLimit,
  };
}
