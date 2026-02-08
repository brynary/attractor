import type { SSEEvent } from "../../utils/sse.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { FinishReason, Usage } from "../../types/response.js";
import { StreamEventType } from "../../types/stream-event.js";
import { str, num, rec, recArray } from "../../utils/extract.js";

function mapFinishReason(raw: string): FinishReason {
  switch (raw) {
    case "stop":
      return { reason: "stop", raw };
    case "tool_calls":
      return { reason: "tool_calls", raw };
    case "length":
      return { reason: "length", raw };
    case "content_filter":
      return { reason: "content_filter", raw };
    default:
      return { reason: "other", raw };
  }
}

function translateUsage(
  usageData: Record<string, unknown> | undefined,
): Usage | undefined {
  if (!usageData) {
    return undefined;
  }

  const inputTokens = num(usageData["prompt_tokens"]);
  const outputTokens = num(usageData["completion_tokens"]);
  const totalFromApi = num(usageData["total_tokens"]);

  const result: Usage = {
    inputTokens,
    outputTokens,
    totalTokens: totalFromApi > 0 ? totalFromApi : inputTokens + outputTokens,
    raw: usageData,
  };

  // Note: reasoning_tokens and cached_tokens are Responses API features.
  // Most OpenAI-compatible services (vLLM, Ollama, Together AI, Groq) do NOT provide these.
  // The code below attempts extraction for compatibility with services that do support them,
  // but these fields will typically be undefined for third-party services.
  const completionDetails = rec(usageData["completion_tokens_details"]);
  if (
    completionDetails &&
    typeof completionDetails["reasoning_tokens"] === "number"
  ) {
    result.reasoningTokens = completionDetails["reasoning_tokens"];
  }

  const promptDetails = rec(usageData["prompt_tokens_details"]);
  if (promptDetails && typeof promptDetails["cached_tokens"] === "number") {
    result.cacheReadTokens = promptDetails["cached_tokens"];
  }

  return result;
}

export async function* translateStream(
  events: AsyncGenerator<SSEEvent>,
): AsyncGenerator<StreamEvent> {
  let streamStarted = false;
  let textStarted = false;
  let streamId: string | undefined;
  // Track active tool call IDs by index for proper lifecycle
  const activeToolCalls = new Map<number, string>();
  let finishReason = "";
  // Defer FINISH emission so we can merge usage from a trailing usage-only chunk
  let pendingFinishReason: FinishReason | undefined;

  for await (const sse of events) {
    // Emit PROVIDER_EVENT for non-message SSE events
    if (sse.event !== "message") {
      yield {
        type: StreamEventType.PROVIDER_EVENT,
        eventType: sse.event,
        raw: sse.data,
      };
      continue;
    }

    // Handle [DONE] sentinel
    if (sse.data === "[DONE]") {
      if (textStarted) {
        textStarted = false;
        yield { type: StreamEventType.TEXT_END };
      }
      // Close any remaining open tool calls
      for (const [, toolCallId] of activeToolCalls) {
        yield { type: StreamEventType.TOOL_CALL_END, toolCallId };
      }
      activeToolCalls.clear();
      // Emit deferred FINISH if no usage-only chunk followed
      if (pendingFinishReason) {
        yield {
          type: StreamEventType.FINISH,
          finishReason: pendingFinishReason,
          usage: undefined,
        };
        pendingFinishReason = undefined;
      }
      continue;
    }

    let parsed: Record<string, unknown> | undefined;
    try {
      const rawParsed: unknown = JSON.parse(sse.data);
      parsed = rec(rawParsed);
    } catch {
      continue;
    }
    if (!parsed) continue;

    // Emit stream start on first chunk
    if (!streamStarted) {
      streamStarted = true;
      const model =
        typeof parsed["model"] === "string" ? parsed["model"] : undefined;
      streamId = typeof parsed["id"] === "string" ? parsed["id"] : undefined;
      yield { type: StreamEventType.STREAM_START, id: streamId, model };
    }

    const choices = recArray(parsed["choices"]);
    if (choices.length === 0) {
      // Check for usage-only chunk (stream_options: include_usage)
      const usageData = rec(parsed["usage"]);
      if (usageData) {
        const usage = translateUsage(usageData);
        const reason = pendingFinishReason ?? mapFinishReason(finishReason || "stop");
        pendingFinishReason = undefined;
        yield {
          type: StreamEventType.FINISH,
          finishReason: reason,
          usage,
        };
      }
      continue;
    }

    const choice = choices[0];
    if (!choice) continue;

    // Capture finish_reason
    const choiceFinish = choice["finish_reason"];
    if (typeof choiceFinish === "string") {
      finishReason = choiceFinish;
    }

    const delta = rec(choice["delta"]);
    if (!delta) continue;

    // Content delta
    const content = delta["content"];
    if (typeof content === "string") {
      if (!textStarted) {
        textStarted = true;
        yield { type: StreamEventType.TEXT_START };
      }
      yield { type: StreamEventType.TEXT_DELTA, delta: content };
    }

    // Tool calls delta
    const toolCallsArr = recArray(delta["tool_calls"]);
    for (const tc of toolCallsArr) {
      const index = typeof tc["index"] === "number" ? tc["index"] : 0;
      const fn = rec(tc["function"]);

      // New tool call: has id and function.name
      const tcId = tc["id"];
      if (typeof tcId === "string" && fn && typeof fn["name"] === "string") {
        // Close text if open
        if (textStarted) {
          textStarted = false;
          yield { type: StreamEventType.TEXT_END };
        }
        activeToolCalls.set(index, tcId);
        yield {
          type: StreamEventType.TOOL_CALL_START,
          toolCallId: tcId,
          toolName: str(fn["name"]),
        };
      }

      // Arguments delta
      if (fn && typeof fn["arguments"] === "string") {
        const toolCallId = activeToolCalls.get(index) ?? "";
        yield {
          type: StreamEventType.TOOL_CALL_DELTA,
          toolCallId,
          argumentsDelta: fn["arguments"],
        };
      }
    }

    // On finish_reason, close open text/tool calls and defer finish
    if (typeof choiceFinish === "string") {
      if (textStarted) {
        textStarted = false;
        yield { type: StreamEventType.TEXT_END };
      }
      for (const [, toolCallId] of activeToolCalls) {
        yield { type: StreamEventType.TOOL_CALL_END, toolCallId };
      }
      activeToolCalls.clear();

      // If usage is in this same chunk, emit FINISH now; otherwise defer
      const usageData = rec(parsed["usage"]);
      const usage = translateUsage(usageData);
      if (usage) {
        yield {
          type: StreamEventType.FINISH,
          finishReason: mapFinishReason(choiceFinish),
          usage,
        };
      } else {
        pendingFinishReason = mapFinishReason(choiceFinish);
      }
    }
  }
}
