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
  const choices = recArray(body["choices"]);
  const firstChoice = choices.length > 0 ? choices[0] : undefined;
  const messageData = firstChoice ? rec(firstChoice["message"]) : undefined;

  const contentParts: ContentPart[] = [];

  if (messageData) {
    const contentStr = messageData["content"];
    if (typeof contentStr === "string") {
      contentParts.push({ kind: "text", text: contentStr });
    }

    const toolCalls = recArray(messageData["tool_calls"]);
    for (const tc of toolCalls) {
      const fn = rec(tc["function"]);
      if (!fn) continue;

      const rawArgs =
        typeof fn["arguments"] === "string" ? fn["arguments"] : "{}";
      const parsed = safeJsonParse(rawArgs);
      const parsedRecord = parsed.success ? rec(parsed.value) : undefined;

      contentParts.push({
        kind: "tool_call",
        toolCall: {
          id: str(tc["id"]),
          name: str(fn["name"]),
          arguments: parsedRecord ?? {},
          rawArguments: rawArgs,
        },
      });
    }
  }

  const rawFinishReason = str(firstChoice?.["finish_reason"]);
  const hasToolCalls = contentParts.some((p) => p.kind === "tool_call");

  const message: Message = {
    role: Role.ASSISTANT,
    content: contentParts,
  };

  const usageData = rec(body["usage"]);
  const inputTokens = usageData ? num(usageData["prompt_tokens"]) : 0;
  const outputTokens = usageData ? num(usageData["completion_tokens"]) : 0;

  const completionDetails = rec(usageData?.["completion_tokens_details"]);
  const reasoningTokens = completionDetails && typeof completionDetails["reasoning_tokens"] === "number"
    ? completionDetails["reasoning_tokens"]
    : undefined;

  const promptDetails = rec(usageData?.["prompt_tokens_details"]);
  const cacheReadTokens = promptDetails && typeof promptDetails["cached_tokens"] === "number"
    ? promptDetails["cached_tokens"]
    : undefined;

  const usage = normalizeUsage(inputTokens, outputTokens, {
    reasoningTokens,
    cacheReadTokens,
    raw: usageData,
  });

  const result: Response = {
    id: str(body["id"]),
    model: str(body["model"]),
    provider: "openai-compatible",
    message,
    finishReason: {
      reason: mapFinishReason(rawFinishReason, hasToolCalls, "openai_compatible"),
      raw: rawFinishReason,
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
