import type { ToolDefinition } from "unified-llm";
import type { ToolRegistry } from "./tool-registry.js";
import type { ExecutionEnvironment } from "./execution-env.js";
import type { SubAgentHandle, SubAgentDepthConfig } from "../tools/subagent-tools.js";

export interface EnvironmentContextOptions {
  isGitRepo?: boolean;
  gitBranch?: string;
  modifiedCount?: number;
  untrackedCount?: number;
  recentCommits?: string[];
  modelDisplayName?: string;
  knowledgeCutoff?: string;
}

export interface ProviderProfile {
  id: string;
  model: string;
  toolRegistry: ToolRegistry;
  knowledgeCutoff?: string;
  subagentHandles?: Map<string, SubAgentHandle>;
  subagentDepthConfig?: SubAgentDepthConfig;
  buildSystemPrompt(
    environment: ExecutionEnvironment,
    projectDocs: string,
    envOptions?: EnvironmentContextOptions,
    userInstructions?: string,
  ): string;
  tools(): ToolDefinition[];
  providerOptions(): Record<string, Record<string, unknown>> | null;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsParallelToolCalls: boolean;
  contextWindowSize: number;
}
