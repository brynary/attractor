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
  toolOutputLimits?: Record<string, number>;
  toolLineLimits?: Record<string, number>;
  enableLoopDetection: boolean;
  loopDetectionWindow: number;
  maxSubagentDepth: number;
  /** Spec extension: pre/post hooks for tool call interception (e.g., approval gates). */
  toolCallInterceptor?: ToolCallInterceptor;
  /** Spec extension: user instruction override appended last in system prompt (highest priority). */
  userInstructions?: string;
  /** Spec extension: enables streaming via Client.stream() instead of Client.complete(). */
  enableStreaming: boolean;
  /**
   * Optional hook to classify whether an assistant response requires user input.
   * When omitted, a conservative built-in heuristic is used.
   */
  awaitingInputDetector?: (assistantText: string) => boolean;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxTurns: 0,
  maxToolRoundsPerInput: 200,
  defaultCommandTimeoutMs: 10_000,
  maxCommandTimeoutMs: 600_000,
  reasoningEffort: null,
  toolOutputLimits: undefined,
  toolLineLimits: undefined,
  enableLoopDetection: true,
  loopDetectionWindow: 10,
  maxSubagentDepth: 1,
  enableStreaming: false,
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
