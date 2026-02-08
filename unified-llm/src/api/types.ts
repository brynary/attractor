import type { ToolCall, ToolResult } from "../types/tool.js";
import type {
  FinishReason,
  Usage,
  Warning,
  Response,
} from "../types/response.js";
import type { StreamEvent } from "../types/stream-event.js";

export interface StepResult {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finishReason: FinishReason;
  usage: Usage;
  response: Response;
  warnings: Warning[];
}

export interface GenerateResult {
  text: string;
  reasoning?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  finishReason: FinishReason;
  usage: Usage;
  totalUsage: Usage;
  steps: StepResult[];
  response: Response;
  output?: unknown;
}

export type StopCondition = (steps: StepResult[]) => boolean;

export interface StreamResult {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
  response(): Promise<Response>;
  readonly partialResponse: Response;
  readonly textStream: AsyncGenerator<string>;
  readonly totalUsage: Usage;
}
