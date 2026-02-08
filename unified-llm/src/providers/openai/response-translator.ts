import type { Response, RateLimitInfo } from "../../types/response.js";
import type { Message } from "../../types/message.js";
import type { ContentPart } from "../../types/content-part.js";
import { Role } from "../../types/role.js";
import { str, num, rec, recArray } from "../../utils/extract.js";
import { safeJsonParse } from "../../utils/json.js";
import { mapFinishReason, normalizeUsage } from "../../utils/normalize-response.js";

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
      contentParts.push({
        kind: "tool_call",
        toolCall: {
          id: str(item["id"]),
          name: str(item["name"]),
          arguments: parsedRecord ?? {},
          rawArguments: rawArgs,
        },
      });
    }
  }

  const hasToolCalls = contentParts.some((p) => p.kind === "tool_call");
  const status = str(body["status"]);

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const usageData = rec(body["usage"]);
  const inputTokens = usageData ? num(usageData["input_tokens"]) : 0;
  const outputTokens = usageData ? num(usageData["output_tokens"]) : 0;

  const outputDetails = rec(usageData?.["output_tokens_details"]);
  const reasoningTokens = outputDetails && typeof outputDetails["reasoning_tokens"] === "number"
    ? outputDetails["reasoning_tokens"]
    : undefined;

  const inputDetails = rec(usageData?.["input_tokens_details"]);
  const cacheReadTokens = inputDetails && typeof inputDetails["cached_tokens"] === "number"
    ? inputDetails["cached_tokens"]
    : undefined;

  const usage = normalizeUsage(inputTokens, outputTokens, {
    reasoningTokens,
    cacheReadTokens,
    raw: usageData,
  });

  const result: Response = {
    id: str(body["id"]),
    model: str(body["model"]),
    provider: "openai",
    message,
    finishReason: {
      reason: mapFinishReason(status, hasToolCalls, "openai"),
      raw: status,
    },
    usage,
    raw: body,
    warnings: [],
  };

  if (rateLimit) {
    result.rateLimit = rateLimit;
  }

  return result;
}
