import type { ToolDefinition } from "unified-llm";
import type { ToolRegistry } from "./tool-registry.js";
import type { ExecutionEnvironment } from "./execution-env.js";

export interface EnvironmentContextOptions {
  isGitRepo?: boolean;
  gitBranch?: string;
  modelDisplayName?: string;
  knowledgeCutoff?: string;
}

export interface ProviderProfile {
  id: string;
  model: string;
  toolRegistry: ToolRegistry;
  buildSystemPrompt(
    environment: ExecutionEnvironment,
    projectDocs: string,
    envOptions?: EnvironmentContextOptions,
  ): string;
  tools(): ToolDefinition[];
  providerOptions(): Record<string, Record<string, unknown>> | null;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsParallelToolCalls: boolean;
  contextWindowSize: number;
}
