import type { Response, Usage, RateLimitInfo } from "../../types/response.js";
import type { Message } from "../../types/message.js";
import type { ContentPart } from "../../types/content-part.js";
import { Role } from "../../types/role.js";
import { str, num, rec, recArray } from "../../utils/extract.js";
import { safeJsonParse } from "../../utils/json.js";

function mapFinishReason(status: string): Response["finishReason"] {
  switch (status) {
    case "completed":
      return { reason: "stop", raw: status };
    case "incomplete":
      return { reason: "length", raw: status };
    case "failed":
      return { reason: "error", raw: status };
    default:
      return { reason: "other", raw: status };
  }
}

function translateUsage(usageData: Record<string, unknown> | undefined): Usage {
  if (!usageData) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const inputTokens = num(usageData["input_tokens"]);
  const outputTokens = num(usageData["output_tokens"]);

  const result: Usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    raw: usageData,
  };

  const outputDetails = rec(usageData["output_tokens_details"]);
  if (outputDetails && typeof outputDetails["reasoning_tokens"] === "number") {
    result.reasoningTokens = outputDetails["reasoning_tokens"];
  }

  const inputDetails = rec(usageData["input_tokens_details"]);
  if (inputDetails && typeof inputDetails["cached_tokens"] === "number") {
    result.cacheReadTokens = inputDetails["cached_tokens"];
  }

  return result;
}

export function translateResponse(
  body: Record<string, unknown>,
  rateLimit?: RateLimitInfo,
): Response {
  const output = recArray(body["output"]);
  const contentParts: ContentPart[] = [];

  for (const item of output) {
    const itemType = str(item["type"]);
    if (itemType === "message" && Array.isArray(item["content"])) {
      for (const contentItem of item["content"]) {
        const ci = rec(contentItem);
        if (ci && str(ci["type"]) === "output_text" && typeof ci["text"] === "string") {
          contentParts.push({ kind: "text", text: ci["text"] });
        }
      }
    } else if (itemType === "function_call") {
      const rawArgs = typeof item["arguments"] === "string" ? item["arguments"] : "{}";
      const parsed = safeJsonParse(rawArgs);
      const parsedRecord = parsed.success ? rec(parsed.value) : undefined;
      const parsedArgs: Record<string, unknown> | string = parsedRecord ?? rawArgs;
      contentParts.push({
        kind: "tool_call",
        toolCall: {
          id: str(item["id"]),
          name: str(item["name"]),
          arguments: parsedArgs,
        },
      });
    }
  }

  const hasToolCalls = contentParts.some((p) => p.kind === "tool_call");
  const status = str(body["status"]);
  const finishReason = hasToolCalls
    ? { reason: "tool_calls" as const, raw: status }
    : mapFinishReason(status);

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const result: Response = {
    id: str(body["id"]),
    model: str(body["model"]),
    provider: "openai",
    message,
    finishReason,
    usage: translateUsage(rec(body["usage"])),
    raw: body,
    warnings: [],
  };

  if (rateLimit) {
    result.rateLimit = rateLimit;
  }

  return result;
}
