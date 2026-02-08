import type { ToolCallData, ToolResult, Usage } from "unified-llm";

export const SessionState = {
  IDLE: "idle",
  PROCESSING: "processing",
  AWAITING_INPUT: "awaiting_input",
  CLOSED: "closed",
} as const;

export type SessionState = (typeof SessionState)[keyof typeof SessionState];

export interface ToolCallInterceptor {
  pre?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  post?: (toolName: string, args: Record<string, unknown>, output: string) => Promise<void>;
}

export interface SessionConfig {
  maxTurns: number;
  maxToolRoundsPerInput: number;
  defaultCommandTimeoutMs: number;
  maxCommandTimeoutMs: number;
  reasoningEffort: "low" | "medium" | "high" | null;
  toolOutputLimits: { maxChars: number; maxLines: number };
  enableLoopDetection: boolean;
  loopDetectionWindow: number;
  maxSubagentDepth: number;
  toolCallInterceptor?: ToolCallInterceptor;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxTurns: 0,
  maxToolRoundsPerInput: 50,
  defaultCommandTimeoutMs: 120_000,
  maxCommandTimeoutMs: 600_000,
  reasoningEffort: null,
  toolOutputLimits: { maxChars: 30_000, maxLines: 500 },
  enableLoopDetection: true,
  loopDetectionWindow: 5,
  maxSubagentDepth: 1,
};

export interface UserTurn {
  kind: "user";
  content: string;
  timestamp: Date;
}

export interface AssistantTurn {
  kind: "assistant";
  content: string;
  toolCalls: ToolCallData[];
  reasoning: string | null;
  usage: Usage;
  responseId: string | null;
  timestamp: Date;
}

export interface ToolResultsTurn {
  kind: "tool_results";
  results: ToolResult[];
  timestamp: Date;
}

export interface SystemTurn {
  kind: "system";
  content: string;
  timestamp: Date;
}

export interface SteeringTurn {
  kind: "steering";
  content: string;
  timestamp: Date;
}

export type Turn =
  | UserTurn
  | AssistantTurn
  | ToolResultsTurn
  | SystemTurn
  | SteeringTurn;
