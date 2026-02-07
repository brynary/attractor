export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute?: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string | Record<string, unknown> | unknown[];
  isError: boolean;
}

export type ToolChoice =
  | { mode: "auto" }
  | { mode: "none" }
  | { mode: "required" }
  | { mode: "named"; toolName: string };
