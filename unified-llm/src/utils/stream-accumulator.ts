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

interface TextSegment {
  id: string;
  text: string;
  order: number;
}

interface ReasoningSegment {
  id: string;
  text: string;
  redacted: boolean;
  order: number;
  signature?: string;
}

export class StreamAccumulator {
  private textSegments: Map<string, TextSegment> = new Map();
  private activeTextSegmentIds: string[] = [];
  private nextTextOrder = 0;
  private nextImplicitTextId = 0;
  private reasoningSegments: Map<string, ReasoningSegment> = new Map();
  private activeReasoningSegmentIds: string[] = [];
  private nextReasoningOrder = 0;
  private nextImplicitReasoningId = 0;
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

  private ensureTextSegment(id: string): TextSegment {
    const existing = this.textSegments.get(id);
    if (existing) {
      return existing;
    }
    const created: TextSegment = { id, text: "", order: this.nextTextOrder++ };
    this.textSegments.set(id, created);
    return created;
  }

  private ensureReasoningSegment(id: string): ReasoningSegment {
    const existing = this.reasoningSegments.get(id);
    if (existing) {
      return existing;
    }
    const created: ReasoningSegment = {
      id,
      text: "",
      redacted: false,
      order: this.nextReasoningOrder++,
    };
    this.reasoningSegments.set(id, created);
    return created;
  }

  private activateTextSegment(id: string): void {
    const idx = this.activeTextSegmentIds.lastIndexOf(id);
    if (idx !== -1) {
      this.activeTextSegmentIds.splice(idx, 1);
    }
    this.activeTextSegmentIds.push(id);
  }

  private deactivateTextSegment(id?: string): void {
    if (id === undefined) {
      this.activeTextSegmentIds.pop();
      return;
    }
    const idx = this.activeTextSegmentIds.lastIndexOf(id);
    if (idx !== -1) {
      this.activeTextSegmentIds.splice(idx, 1);
    }
  }

  private activateReasoningSegment(id: string): void {
    const idx = this.activeReasoningSegmentIds.lastIndexOf(id);
    if (idx !== -1) {
      this.activeReasoningSegmentIds.splice(idx, 1);
    }
    this.activeReasoningSegmentIds.push(id);
  }

  private deactivateReasoningSegment(id?: string): void {
    if (id === undefined) {
      this.activeReasoningSegmentIds.pop();
      return;
    }
    const idx = this.activeReasoningSegmentIds.lastIndexOf(id);
    if (idx !== -1) {
      this.activeReasoningSegmentIds.splice(idx, 1);
    }
  }

  private resolveTextSegmentId(
    explicitId: string | undefined,
    createIfMissing: boolean,
  ): string | undefined {
    if (explicitId && explicitId.length > 0) {
      return explicitId;
    }
    const active = this.activeTextSegmentIds[this.activeTextSegmentIds.length - 1];
    if (active) {
      return active;
    }
    if (!createIfMissing) {
      return undefined;
    }
    return `text_${this.nextImplicitTextId++}`;
  }

  private resolveReasoningSegmentId(
    explicitId: string | undefined,
    createIfMissing: boolean,
  ): string | undefined {
    if (explicitId && explicitId.length > 0) {
      return explicitId;
    }
    const active =
      this.activeReasoningSegmentIds[this.activeReasoningSegmentIds.length - 1];
    if (active) {
      return active;
    }
    if (!createIfMissing) {
      return undefined;
    }
    return `reasoning_${this.nextImplicitReasoningId++}`;
  }

  private sortedTextSegments(): TextSegment[] {
    return [...this.textSegments.values()].sort((a, b) => a.order - b.order);
  }

  private sortedReasoningSegments(): ReasoningSegment[] {
    return [...this.reasoningSegments.values()].sort((a, b) => a.order - b.order);
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
        if (event.warnings && event.warnings.length > 0) {
          this.warnings.push(...event.warnings);
        }
        break;

      case StreamEventType.TEXT_START:
        {
          const id = this.resolveTextSegmentId(event.textId, true);
          if (id) {
            this.ensureTextSegment(id);
            this.activateTextSegment(id);
          }
        }
        break;

      case StreamEventType.TEXT_DELTA:
        {
          const id = this.resolveTextSegmentId(event.textId, true);
          if (id) {
            const segment = this.ensureTextSegment(id);
            segment.text += event.delta;
            if (event.textId) {
              this.activateTextSegment(id);
            }
          }
        }
        break;

      case StreamEventType.TEXT_END:
        {
          const id = this.resolveTextSegmentId(event.textId, false);
          if (id) {
            this.deactivateTextSegment(id);
          } else {
            this.deactivateTextSegment();
          }
        }
        break;

      case StreamEventType.REASONING_START:
        {
          const id = this.resolveReasoningSegmentId(event.reasoningId, true);
          if (id) {
            this.ensureReasoningSegment(id);
            this.activateReasoningSegment(id);
          }
        }
        break;

      case StreamEventType.REASONING_DELTA:
        {
          const id = this.resolveReasoningSegmentId(event.reasoningId, true);
          if (id) {
            const segment = this.ensureReasoningSegment(id);
            segment.text += event.reasoningDelta;
            if (event.redacted) {
              segment.redacted = true;
            }
            if (event.reasoningId) {
              this.activateReasoningSegment(id);
            }
          }
        }
        break;

      case StreamEventType.REASONING_END:
        {
          const id = this.resolveReasoningSegmentId(event.reasoningId, false);
          if (id) {
            const segment = this.reasoningSegments.get(id);
            if (segment && !segment.redacted && event.signature) {
              segment.signature = event.signature;
            }
            this.deactivateReasoningSegment(id);
          } else {
            this.deactivateReasoningSegment();
          }
        }
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
    for (const segment of this.sortedReasoningSegments()) {
      if (!segment.redacted && segment.text.length === 0) {
        continue;
      }
      if (segment.redacted) {
        content.push({
          kind: "redacted_thinking",
          thinking: {
            text: segment.text,
            redacted: true,
          },
        });
      } else {
        content.push({
          kind: "thinking",
          thinking: {
            text: segment.text,
            signature: segment.signature,
            redacted: false,
          },
        });
      }
    }

    // Add text parts
    const fullText = this.sortedTextSegments()
      .map((segment) => segment.text)
      .join("");
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
    this.textSegments.clear();
    this.activeTextSegmentIds = [];
    this.nextTextOrder = 0;
    this.nextImplicitTextId = 0;
    this.reasoningSegments.clear();
    this.activeReasoningSegmentIds = [];
    this.nextReasoningOrder = 0;
    this.nextImplicitReasoningId = 0;
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
