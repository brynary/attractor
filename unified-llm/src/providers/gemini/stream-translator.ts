import type { StreamEvent } from "../../types/stream-event.js";
import { StreamEventType } from "../../types/stream-event.js";
import type { FinishReason, Usage } from "../../types/response.js";
import type { SSEEvent } from "../../utils/sse.js";
import { str, num, optNum, rec, recArray } from "../../utils/extract.js";

export async function* translateStream(
  events: AsyncGenerator<SSEEvent>,
): AsyncGenerator<StreamEvent> {
  let textStarted = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let rawUsage: Record<string, unknown> | undefined;
  let finishReason = "STOP";
  let yieldedStart = false;
  let emittedToolCalls = false;

  for await (const event of events) {
    if (event.data === "[DONE]") {
      break;
    }

    // Emit PROVIDER_EVENT for non-message SSE events
    if (event.event !== "message") {
      yield {
        type: StreamEventType.PROVIDER_EVENT,
        eventType: event.event,
        raw: event.data,
      };
      continue;
    }

    let parsed: Record<string, unknown> | undefined;
    try {
      const rawParsed: unknown = JSON.parse(event.data);
      parsed = rec(rawParsed);
    } catch {
      continue;
    }
    if (!parsed) continue;

    if (!yieldedStart) {
      yieldedStart = true;
      yield {
        type: StreamEventType.STREAM_START,
        model: str(parsed["modelVersion"]),
      };
    }

    const candidates = recArray(parsed["candidates"]);
    const candidate = candidates[0];

    if (candidate) {
      const content = rec(candidate["content"]);
      const parts = recArray(content?.["parts"]);

      for (const part of parts) {
        if (typeof part["text"] === "string" && part["thought"] === true) {
          yield { type: StreamEventType.REASONING_START };
          yield {
            type: StreamEventType.REASONING_DELTA,
            reasoningDelta: str(part["text"]),
          };
          yield { type: StreamEventType.REASONING_END };
          continue;
        }

        if (typeof part["text"] === "string") {
          if (!textStarted) {
            textStarted = true;
            yield { type: StreamEventType.TEXT_START };
          }
          yield {
            type: StreamEventType.TEXT_DELTA,
            delta: str(part["text"]),
          };
          continue;
        }

        const functionCall = rec(part["functionCall"]);
        if (functionCall) {
          emittedToolCalls = true;
          const toolCallId = `call_${crypto.randomUUID()}`;
          yield {
            type: StreamEventType.TOOL_CALL_START,
            toolCallId,
            toolName: str(functionCall["name"]),
          };
          yield {
            type: StreamEventType.TOOL_CALL_DELTA,
            toolCallId,
            argumentsDelta: JSON.stringify(functionCall["args"] ?? {}),
          };
          yield {
            type: StreamEventType.TOOL_CALL_END,
            toolCallId,
          };
        }
      }

      const candidateFinish = str(candidate["finishReason"]);
      if (candidateFinish) {
        finishReason = candidateFinish;
      }
    }

    const usageData = rec(parsed["usageMetadata"]);
    if (usageData) {
      inputTokens = num(usageData["promptTokenCount"]);
      outputTokens = num(usageData["candidatesTokenCount"]);
      reasoningTokens = optNum(usageData["thoughtsTokenCount"]);
      cacheReadTokens = optNum(usageData["cachedContentTokenCount"]);
      // Gemini does not provide cache write tokens in generateContent responses
      cacheWriteTokens = undefined;
      rawUsage = usageData;
    }
  }

  if (textStarted) {
    yield { type: StreamEventType.TEXT_END };
  }

  const mappedReason = mapFinishReason(finishReason, emittedToolCalls);
  const usage: Usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    raw: rawUsage,
  };

  yield {
    type: StreamEventType.FINISH,
    finishReason: mappedReason,
    usage,
  };
}

function mapFinishReason(reason: string, hasToolCalls: boolean): FinishReason {
  switch (reason) {
    case "STOP":
      return hasToolCalls
        ? { reason: "tool_calls", raw: reason }
        : { reason: "stop", raw: reason };
    case "MAX_TOKENS":
      return { reason: "length", raw: reason };
    case "SAFETY":
    case "RECITATION":
      return { reason: "content_filter", raw: reason };
    default:
      return hasToolCalls
        ? { reason: "tool_calls", raw: reason }
        : { reason: "other", raw: reason };
  }
}
