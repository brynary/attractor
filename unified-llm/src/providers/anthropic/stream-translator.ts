import type { StreamEvent } from "../../types/stream-event.js";
import { StreamEventType } from "../../types/stream-event.js";
import type { FinishReason, Usage } from "../../types/response.js";
import type { SSEEvent } from "../../utils/sse.js";
import { str, num, optNum, rec } from "../../utils/extract.js";
import { StreamError } from "../../types/errors.js";

type BlockType = "text" | "tool_use" | "thinking" | "redacted_thinking";

export async function* translateStream(
  events: AsyncGenerator<SSEEvent>,
): AsyncGenerator<StreamEvent> {
  let currentBlockType: BlockType | undefined;
  let currentBlockIndex: string | undefined;
  let currentToolCallId = "";
  let currentSignature: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let model: string | undefined;
  let messageId: string | undefined;
  let finishReason = "stop";
  let reasoningWordCount = 0;
  let rawUsage: Record<string, unknown> = {};

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
          messageId = typeof message["id"] === "string" ? message["id"] : undefined;
          const usage = rec(message["usage"]);
          if (usage) {
            inputTokens = num(usage["input_tokens"]);
            cacheReadTokens = optNum(usage["cache_read_input_tokens"]);
            cacheWriteTokens = optNum(usage["cache_creation_input_tokens"]);
            rawUsage = { ...rawUsage, ...usage };
          }
        }
        yield { type: StreamEventType.STREAM_START, id: messageId, model };
        break;
      }

      case "content_block_start": {
        const contentBlock = rec(parsed["content_block"]);
        if (!contentBlock) break;
        const blockType = str(contentBlock["type"]);
        const blockIndex = typeof parsed["index"] === "number" ? String(parsed["index"]) : undefined;

        if (blockType === "text") {
          currentBlockType = "text";
          currentBlockIndex = blockIndex;
          yield { type: StreamEventType.TEXT_START, textId: blockIndex };
        } else if (blockType === "tool_use") {
          currentBlockType = "tool_use";
          currentBlockIndex = blockIndex;
          currentToolCallId = str(contentBlock["id"]);
          yield {
            type: StreamEventType.TOOL_CALL_START,
            toolCallId: str(contentBlock["id"]),
            toolName: str(contentBlock["name"]),
          };
        } else if (blockType === "thinking") {
          currentBlockType = "thinking";
          currentBlockIndex = blockIndex;
          currentSignature = typeof contentBlock["signature"] === "string"
            ? contentBlock["signature"]
            : undefined;
          yield { type: StreamEventType.REASONING_START, reasoningId: blockIndex };
        } else if (blockType === "redacted_thinking") {
          currentBlockType = "redacted_thinking";
          currentBlockIndex = blockIndex;
          yield { type: StreamEventType.REASONING_START, reasoningId: blockIndex };
          const redactedData = typeof contentBlock["data"] === "string"
            ? contentBlock["data"]
            : "";
          if (redactedData.length > 0) {
            yield {
              type: StreamEventType.REASONING_DELTA,
              reasoningDelta: redactedData,
              reasoningId: blockIndex,
              redacted: true,
            };
          }
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
            delta: str(delta["text"]),
            textId: currentBlockIndex,
          };
        } else if (deltaType === "input_json_delta") {
          yield {
            type: StreamEventType.TOOL_CALL_DELTA,
            toolCallId: currentToolCallId,
            argumentsDelta: str(delta["partial_json"]),
          };
        } else if (deltaType === "thinking_delta") {
          const thinkingText = str(delta["thinking"]);
          if (currentBlockType === "redacted_thinking") {
            yield {
              type: StreamEventType.REASONING_DELTA,
              reasoningDelta: thinkingText,
              reasoningId: currentBlockIndex,
              redacted: true,
            };
          } else {
            reasoningWordCount += thinkingText.split(/\s+/).filter(Boolean).length;
            yield {
              type: StreamEventType.REASONING_DELTA,
              reasoningDelta: thinkingText,
              reasoningId: currentBlockIndex,
            };
          }
        }
        break;
      }

      case "content_block_stop": {
        if (currentBlockType === "text") {
          yield { type: StreamEventType.TEXT_END, textId: currentBlockIndex };
        } else if (currentBlockType === "tool_use") {
          yield {
            type: StreamEventType.TOOL_CALL_END,
            toolCallId: currentToolCallId,
          };
        } else if (currentBlockType === "thinking" || currentBlockType === "redacted_thinking") {
          yield {
            type: StreamEventType.REASONING_END,
            reasoningId: currentBlockIndex,
            signature: currentSignature,
          };
          currentSignature = undefined;
        }
        currentBlockType = undefined;
        currentBlockIndex = undefined;
        break;
      }

      case "message_delta": {
        const delta = rec(parsed["delta"]);
        if (delta && typeof delta["stop_reason"] === "string") {
          finishReason = delta["stop_reason"];
        }
        const usage = rec(parsed["usage"]);
        if (usage) {
          if (typeof usage["output_tokens"] === "number") {
            outputTokens = usage["output_tokens"];
          }
          rawUsage = { ...rawUsage, ...usage };
        }
        break;
      }

      case "message_stop": {
        const mappedReason = mapFinishReason(finishReason);
        const usage: Usage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          reasoningTokens: reasoningWordCount > 0 ? Math.ceil(reasoningWordCount * 1.3) : undefined,
          cacheReadTokens,
          cacheWriteTokens,
          raw: rawUsage,
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
          error: new StreamError(message),
        };
        break;
      }

      default:
        // Emit PROVIDER_EVENT for unrecognized event types
        if (eventType) {
          yield {
            type: StreamEventType.PROVIDER_EVENT,
            eventType,
            raw: parsed,
          };
        }
        break;
    }
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return { reason: "stop", raw: reason };
    case "max_tokens":
      return { reason: "length", raw: reason };
    case "tool_use":
      return { reason: "tool_calls", raw: reason };
    default:
      return { reason: "other", raw: reason };
  }
}
