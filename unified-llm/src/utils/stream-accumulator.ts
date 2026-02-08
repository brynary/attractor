import type { StreamEvent } from "../types/stream-event.js";
import { StreamEventType } from "../types/stream-event.js";
import type { Response, Usage, FinishReason, Warning } from "../types/response.js";
import type { ContentPart, ToolCallData } from "../types/content-part.js";
import type { ToolCall, ToolResult } from "../types/tool.js";
import { Role } from "../types/role.js";
import { rec } from "./extract.js";
import { responseText, responseToolCalls, responseReasoning } from "../types/response.js";

/**
 * StepResult captures the results of a single step in a multi-step tool execution loop.
 * This is an internal representation used by StreamAccumulator that matches the Layer 4 API type.
 */
interface StepResult {
  text: string;
  reasoning: string | undefined;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finishReason: FinishReason;
  usage: Usage;
  response: Response;
  warnings: Warning[];
}

/**
 * Convert ToolCallData to ToolCall by ensuring arguments is an object.
 */
function toToolCall(data: ToolCallData): ToolCall {
  const args = typeof data.arguments === "string" ? {} : data.arguments;
  return {
    id: data.id,
    name: data.name,
    arguments: args,
    rawArguments: data.rawArguments,
  };
}

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
  private streamId = "";
  private model = "";
  private provider: string;
  private finishReason: FinishReason = { reason: "other" };
  private usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  private warnings: Warning[] = [];
  private steps: StepResult[] = [];

  constructor(provider = "") {
    this.provider = provider;
  }

  process(event: StreamEvent): void {
    switch (event.type) {
      case StreamEventType.STREAM_START:
        if (event.model) {
          this.model = event.model;
        }
        if (event.id) {
          this.streamId = event.id;
        }
        break;

      case StreamEventType.TEXT_START:
        this.currentText = "";
        break;

      case StreamEventType.TEXT_DELTA:
        this.currentText += event.delta;
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
        this.currentReasoning += event.reasoningDelta;
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
        this.finishReason = event.finishReason;
        if (event.usage) {
          this.usage = event.usage;
        }
        break;
      }

      case StreamEventType.STEP_FINISH:
      case StreamEventType.ERROR:
      case StreamEventType.PROVIDER_EVENT:
        // No accumulation needed
        break;
    }
  }

  addWarning(warning: Warning): void {
    this.warnings.push(warning);
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
      id: this.streamId,
      model: this.model,
      provider: this.provider,
      message: {
        role: Role.ASSISTANT,
        content,
      },
      finishReason: this.finishReason,
      usage: this.usage,
      warnings: this.warnings,
    };
  }

  /**
   * Begin a new step in the multi-step tool execution loop.
   * Resets the accumulator state for the new step while preserving step history.
   */
  beginStep(): void {
    this.textParts = [];
    this.currentText = "";
    this.reasoningParts = [];
    this.currentReasoning = "";
    this.reasoningSignature = undefined;
    this.toolCalls.clear();
    this.completedToolCalls = [];
    this.finishReason = { reason: "other" };
    this.usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    this.warnings = [];
  }

  /**
   * Finalize the current step and add it to the step history.
   * Captures the current accumulated response as a StepResult.
   * Tool results should be provided externally (used by Layer 4).
   */
  finalizeStep(toolResults: ToolResult[] = []): void {
    const currentResponse = this.response();
    const toolCallsData = responseToolCalls(currentResponse);
    const stepResult: StepResult = {
      text: responseText(currentResponse),
      reasoning: responseReasoning(currentResponse),
      toolCalls: toolCallsData.map(toToolCall),
      toolResults,
      finishReason: currentResponse.finishReason,
      usage: currentResponse.usage,
      response: currentResponse,
      warnings: currentResponse.warnings,
    };
    this.steps.push(stepResult);
  }

  /**
   * Get all accumulated steps.
   * Returns an array of StepResult objects representing each step in the multi-step loop.
   */
  getSteps(): StepResult[] {
    return this.steps;
  }

  /**
   * Get the number of steps accumulated so far.
   */
  getStepCount(): number {
    return this.steps.length;
  }
}
