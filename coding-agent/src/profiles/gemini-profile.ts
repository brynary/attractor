import type { ToolDefinition } from "unified-llm";
import type { ExecutionEnvironment, EnvironmentContextOptions } from "../types/index.js";
import type { ProviderProfile } from "../types/index.js";
import { ToolRegistry } from "../types/index.js";
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from "../tools/core-tools.js";
import type { SessionFactory, SubAgentDepthConfig } from "../tools/subagent-tools.js";
import {
  createSpawnAgentTool,
  createSendInputTool,
  createWaitTool,
  createCloseAgentTool,
} from "../tools/subagent-tools.js";
import type { SubAgentHandle } from "../tools/subagent-tools.js";
import { GEMINI_BASE_PROMPT } from "./prompts/gemini-base.js";
import {
  buildEnvironmentContext,
  buildSystemPrompt,
} from "./system-prompt.js";

export function createGeminiProfile(
  model: string,
  options?: { sessionFactory?: SessionFactory; subagentConfig?: SubAgentDepthConfig },
): ProviderProfile {
  const registry = new ToolRegistry();
  registry.register(createReadFileTool());
  registry.register(createWriteFileTool());
  registry.register(createEditFileTool());
  registry.register(
    createShellTool({ defaultTimeoutMs: 10_000, maxTimeoutMs: 600_000 }),
  );
  registry.register(createGrepTool());
  registry.register(createGlobTool());

  if (options?.sessionFactory) {
    const agents = new Map<string, SubAgentHandle>();
    const depthConfig = options.subagentConfig ?? { currentDepth: 0, maxDepth: 1 };
    registry.register(createSpawnAgentTool(options.sessionFactory, agents, depthConfig));
    registry.register(createSendInputTool(agents));
    registry.register(createWaitTool(agents));
    registry.register(createCloseAgentTool(agents));
  }

  return {
    id: "gemini",
    model,
    toolRegistry: registry,

    buildSystemPrompt(
      environment: ExecutionEnvironment,
      projectDocs: string,
      envOptions?: EnvironmentContextOptions,
    ): string {
      const envContext = buildEnvironmentContext(environment, envOptions);
      const toolDescs = registry
        .definitions()
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");
      return buildSystemPrompt(
        GEMINI_BASE_PROMPT,
        envContext,
        toolDescs,
        projectDocs,
      );
    },

    tools(): ToolDefinition[] {
      return registry.definitions();
    },

    providerOptions(): Record<string, Record<string, unknown>> | null {
      return null;
    },

    supportsReasoning: false,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 1_000_000,
  };
}
