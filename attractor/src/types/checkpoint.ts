import type { ContextValue } from "./context.js";

export interface Checkpoint {
  pipelineId: string;
  timestamp: string;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  nodeOutcomes: Record<string, string>;
  contextValues: Record<string, ContextValue>;
  logs: string[];
}
