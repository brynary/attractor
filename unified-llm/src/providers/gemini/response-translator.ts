import type { Response, RateLimitInfo } from "../../types/response.js";
import type { ContentPart } from "../../types/content-part.js";
import type { Message } from "../../types/message.js";
import { Role } from "../../types/role.js";
import { str, num, optNum, rec, recArray } from "../../utils/extract.js";
import { mapFinishReason, normalizeUsage } from "../../utils/normalize-response.js";

function translatePart(
  part: Record<string, unknown>,
): ContentPart | undefined {
  if (typeof part["text"] === "string" && part["thought"] === true) {
    return {
      kind: "thinking",
      thinking: {
        text: str(part["text"]),
        redacted: false,
      },
    };
  }

  if (typeof part["text"] === "string") {
    return { kind: "text", text: str(part["text"]) };
  }

  const functionCall = rec(part["functionCall"]);
  if (functionCall) {
    const id = `call_${crypto.randomUUID()}`;
    const thoughtSignature = typeof part["thoughtSignature"] === "string"
      ? part["thoughtSignature"]
      : undefined;
    const args = rec(functionCall["args"]) ?? {};
    return {
      kind: "tool_call",
      toolCall: {
        id,
        name: str(functionCall["name"]),
        arguments: args as Record<string, unknown>,
        rawArguments: JSON.stringify(functionCall["args"] ?? {}),
        type: thoughtSignature,
      },
    };
  }

  return undefined;
}

export function translateResponse(
  body: Record<string, unknown>,
  rateLimit?: RateLimitInfo,
): Response {
  const candidates = recArray(body["candidates"]);
  const candidate = candidates[0] ?? {};
  const content = rec(candidate["content"]);
  const partsArray = recArray(content?.["parts"]);

  const parts: ContentPart[] = [];
  let hasToolCalls = false;

  for (const part of partsArray) {
    const translated = translatePart(part);
    if (translated) {
      parts.push(translated);
      if (translated.kind === "tool_call") {
        hasToolCalls = true;
      }
    }
  }

  const rawFinishReason = str(candidate["finishReason"]);

  const usageData = rec(body["usageMetadata"]);
  const inputTokens = num(usageData?.["promptTokenCount"]);
  const outputTokens = num(usageData?.["candidatesTokenCount"]);
  const reasoningTokens = optNum(usageData?.["thoughtsTokenCount"]);
  const cacheReadTokens = optNum(usageData?.["cachedContentTokenCount"]);
  // Gemini does not provide cache write tokens in generateContent responses
  const cacheWriteTokens = undefined;

  const usage = normalizeUsage(inputTokens, outputTokens, {
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    raw: usageData,
  });

  const message: Message = {
    role: Role.ASSISTANT,
    content: parts,
  };

  return {
    id: str(body["id"]),
    model: str(body["modelVersion"]),
    provider: "gemini",
    message,
    finishReason: {
      reason: mapFinishReason(rawFinishReason, hasToolCalls, "gemini"),
      raw: rawFinishReason,
    },
    usage,
    raw: body,
    warnings: [],
    rateLimit,
  };
}
