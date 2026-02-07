import type { SSEEvent } from "../../utils/sse.js";
import type { StreamEvent } from "../../types/stream-event.js";
import type { Usage } from "../../types/response.js";
import { StreamEventType } from "../../types/stream-event.js";
import { str, num, rec, recArray } from "../../utils/extract.js";

function mapFinishReason(status: string): string {
  switch (status) {
    case "completed":
      return "stop";
    case "incomplete":
      return "length";
    case "failed":
      return "error";
    default:
      return "other";
  }
}

function translateUsage(
  usageData: Record<string, unknown> | undefined,
): Usage | undefined {
  if (!usageData) {
    return undefined;
  }

  const inputTokens = num(usageData["input_tokens"]);
  const outputTokens = num(usageData["output_tokens"]);

  const result: Usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
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

export async function* translateStream(
  events: AsyncGenerator<SSEEvent>,
): AsyncGenerator<StreamEvent> {
  let textStarted = false;

  for await (const sse of events) {
    let parsed: Record<string, unknown> | undefined;
    try {
      const rawParsed: unknown = JSON.parse(sse.data);
      parsed = rec(rawParsed);
    } catch {
      // skip invalid JSON
    }
    if (!parsed) continue;

    switch (sse.event) {
      case "response.created": {
        const model =
          typeof parsed["model"] === "string" ? parsed["model"] : undefined;
        yield { type: StreamEventType.STREAM_START, model };
        break;
      }

      case "response.output_text.delta": {
        if (!textStarted) {
          textStarted = true;
          yield { type: StreamEventType.TEXT_START };
        }
        const delta =
          typeof parsed["delta"] === "string" ? parsed["delta"] : "";
        yield { type: StreamEventType.TEXT_DELTA, text: delta };
        break;
      }

      case "response.output_item.added": {
        const item = rec(parsed["item"]);
        if (item && str(item["type"]) === "function_call") {
          yield {
            type: StreamEventType.TOOL_CALL_START,
            toolCallId: str(item["id"]),
            toolName: str(item["name"]),
          };
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const itemId =
          typeof parsed["item_id"] === "string" ? parsed["item_id"] : "";
        const argsDelta =
          typeof parsed["delta"] === "string" ? parsed["delta"] : "";
        yield {
          type: StreamEventType.TOOL_CALL_DELTA,
          toolCallId: itemId,
          argumentsDelta: argsDelta,
        };
        break;
      }

      case "response.output_item.done": {
        const doneItem = rec(parsed["item"]);
        if (!doneItem) break;
        const doneType = str(doneItem["type"]);
        if (doneType === "output_text") {
          textStarted = false;
          yield { type: StreamEventType.TEXT_END };
        } else if (doneType === "function_call") {
          yield {
            type: StreamEventType.TOOL_CALL_END,
            toolCallId: str(doneItem["id"]),
          };
        }
        break;
      }

      case "response.completed": {
        const respData = rec(parsed["response"]);
        const status = str(respData?.["status"], "completed");
        const usage = translateUsage(rec(respData?.["usage"]));

        const outputItems = recArray(respData?.["output"]);
        const hasToolCalls = outputItems.some(
          (item) => str(item["type"]) === "function_call",
        );
        const finishReason = hasToolCalls
          ? "tool_calls"
          : mapFinishReason(status);

        yield {
          type: StreamEventType.FINISH,
          finishReason,
          usage,
        };
        break;
      }
    }
  }
}
