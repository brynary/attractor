import type { StreamEvent } from "../../types/stream-event.js";
import { StreamEventType } from "../../types/stream-event.js";
import type { Usage } from "../../types/response.js";
import type { SSEEvent } from "../../utils/sse.js";
import { str, num, optNum, rec } from "../../utils/extract.js";

type BlockType = "text" | "tool_use" | "thinking";

export async function* translateStream(
  events: AsyncGenerator<SSEEvent>,
): AsyncGenerator<StreamEvent> {
  let currentBlockType: BlockType | undefined;
  let currentToolCallId = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let model: string | undefined;
  let finishReason = "stop";

  for await (const event of events) {
    if (event.data === "[DONE]") {
      break;
    }

    let parsed: Record<string, unknown> | undefined;
    try {
      const rawParsed: unknown = JSON.parse(event.data);
      parsed = rec(rawParsed);
    } catch {
      // skip invalid JSON
    }
    if (!parsed) continue;

    const eventType = str(parsed["type"]);

    switch (eventType) {
      case "message_start": {
        const message = rec(parsed["message"]);
        if (message) {
          model = typeof message["model"] === "string" ? message["model"] : undefined;
          const usage = rec(message["usage"]);
          if (usage) {
            inputTokens = num(usage["input_tokens"]);
            cacheReadTokens = optNum(usage["cache_read_input_tokens"]);
            cacheWriteTokens = optNum(usage["cache_creation_input_tokens"]);
          }
        }
        yield { type: StreamEventType.STREAM_START, model };
        break;
      }

      case "content_block_start": {
        const contentBlock = rec(parsed["content_block"]);
        if (!contentBlock) break;
        const blockType = str(contentBlock["type"]);

        if (blockType === "text") {
          currentBlockType = "text";
          yield { type: StreamEventType.TEXT_START };
        } else if (blockType === "tool_use") {
          currentBlockType = "tool_use";
          currentToolCallId = str(contentBlock["id"]);
          yield {
            type: StreamEventType.TOOL_CALL_START,
            toolCallId: str(contentBlock["id"]),
            toolName: str(contentBlock["name"]),
          };
        } else if (blockType === "thinking") {
          currentBlockType = "thinking";
          yield { type: StreamEventType.REASONING_START };
        }
        break;
      }

      case "content_block_delta": {
        const delta = rec(parsed["delta"]);
        if (!delta) break;
        const deltaType = str(delta["type"]);

        if (deltaType === "text_delta") {
          yield {
            type: StreamEventType.TEXT_DELTA,
            text: str(delta["text"]),
          };
        } else if (deltaType === "input_json_delta") {
          yield {
            type: StreamEventType.TOOL_CALL_DELTA,
            toolCallId: currentToolCallId,
            argumentsDelta: str(delta["partial_json"]),
          };
        } else if (deltaType === "thinking_delta") {
          yield {
            type: StreamEventType.REASONING_DELTA,
            text: str(delta["thinking"]),
          };
        }
        break;
      }

      case "content_block_stop": {
        if (currentBlockType === "text") {
          yield { type: StreamEventType.TEXT_END };
        } else if (currentBlockType === "tool_use") {
          yield {
            type: StreamEventType.TOOL_CALL_END,
            toolCallId: currentToolCallId,
          };
        } else if (currentBlockType === "thinking") {
          yield { type: StreamEventType.REASONING_END };
        }
        currentBlockType = undefined;
        break;
      }

      case "message_delta": {
        const delta = rec(parsed["delta"]);
        if (delta && typeof delta["stop_reason"] === "string") {
          finishReason = delta["stop_reason"];
        }
        const usage = rec(parsed["usage"]);
        if (usage && typeof usage["output_tokens"] === "number") {
          outputTokens = usage["output_tokens"];
        }
        break;
      }

      case "message_stop": {
        const mappedReason = mapFinishReason(finishReason);
        const usage: Usage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        };
        yield {
          type: StreamEventType.FINISH,
          finishReason: mappedReason,
          usage,
        };
        break;
      }

      case "error": {
        const errorData = rec(parsed["error"]);
        const message = typeof errorData?.["message"] === "string"
          ? errorData["message"]
          : "Unknown stream error";
        yield {
          type: StreamEventType.ERROR,
          error: new Error(message),
        };
        break;
      }
    }
  }
}

function mapFinishReason(reason: string): string {
  switch (reason) {
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
}
