import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import type { Response, Usage, FinishReason } from "../types/response.js";
import type { ContentPart, ToolCallData } from "../types/content-part.js";
import { Role } from "../types/role.js";
import { rec } from "./extract.js";

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsBuffer: string;
}

export class StreamAccumulator {
  private textParts: string[] = [];
  private currentText = "";
  private reasoningParts: string[] = [];
  private currentReasoning = "";
  private reasoningSignature?: string;
  private toolCalls: Map<string, ToolCallAccumulator> = new Map();
  private completedToolCalls: ToolCallData[] = [];
  private model = "";
  private finishReason: FinishReason = { reason: "other" };
  private usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  process(event: StreamEvent): void {
    switch (event.type) {
      case StreamEventType.STREAM_START:
        if (event.model) {
          this.model = event.model;
        }
        break;

      case StreamEventType.TEXT_START:
        this.currentText = "";
        break;

      case StreamEventType.TEXT_DELTA:
        this.currentText += event.text;
        break;

      case StreamEventType.TEXT_END:
        if (this.currentText) {
          this.textParts.push(this.currentText);
        }
        this.currentText = "";
        break;

      case StreamEventType.REASONING_START:
        this.currentReasoning = "";
        break;

      case StreamEventType.REASONING_DELTA:
        this.currentReasoning += event.text;
        break;

      case StreamEventType.REASONING_END:
        if (this.currentReasoning) {
          this.reasoningParts.push(this.currentReasoning);
        }
        this.reasoningSignature = event.signature;
        this.currentReasoning = "";
        break;

      case StreamEventType.TOOL_CALL_START:
        this.toolCalls.set(event.toolCallId, {
          id: event.toolCallId,
          name: event.toolName,
          argumentsBuffer: "",
        });
        break;

      case StreamEventType.TOOL_CALL_DELTA: {
        const tc = this.toolCalls.get(event.toolCallId);
        if (tc) {
          tc.argumentsBuffer += event.argumentsDelta;
        }
        break;
      }

      case StreamEventType.TOOL_CALL_END: {
        const tc = this.toolCalls.get(event.toolCallId);
        if (tc) {
          let parsedArgs: Record<string, unknown> | string;
          try {
            const parsed: unknown = JSON.parse(tc.argumentsBuffer);
            parsedArgs = rec(parsed) ?? tc.argumentsBuffer;
          } catch {
            parsedArgs = tc.argumentsBuffer;
          }
          this.completedToolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: parsedArgs,
          });
          this.toolCalls.delete(event.toolCallId);
        }
        break;
      }

      case StreamEventType.FINISH: {
        const validReasons = ["stop", "length", "tool_calls", "content_filter", "error", "other"] as const;
        const matched = validReasons.find((r) => r === event.finishReason);
        this.finishReason = {
          reason: matched ?? "other",
          raw: event.finishReason,
        };
        if (event.usage) {
          this.usage = event.usage;
        }
        break;
      }

      case StreamEventType.ERROR:
      case StreamEventType.PROVIDER_EVENT:
        // No accumulation needed
        break;
    }
  }

  response(): Response {
    const content: ContentPart[] = [];

    // Add reasoning parts first
    const fullReasoning = this.reasoningParts.join("");
    if (fullReasoning) {
      content.push({
        kind: "thinking",
        thinking: {
          text: fullReasoning,
          signature: this.reasoningSignature,
          redacted: false,
        },
      });
    }

    // Add text parts
    const fullText =
      this.textParts.join("") + (this.currentText ? this.currentText : "");
    if (fullText) {
      content.push({ kind: "text", text: fullText });
    }

    // Add tool calls
    for (const tc of this.completedToolCalls) {
      content.push({
        kind: "tool_call",
        toolCall: tc,
      });
    }

    return {
      id: "",
      model: this.model,
      provider: "",
      message: {
        role: Role.ASSISTANT,
        content,
      },
      finishReason: this.finishReason,
      usage: this.usage,
      warnings: [],
    };
  }
}
