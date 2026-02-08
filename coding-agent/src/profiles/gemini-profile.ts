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
import {
  createListDirTool,
  createReadManyFilesTool,
  createWebSearchTool,
  createWebFetchTool,
} from "../tools/gemini-tools.js";
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
  const agents = new Map<string, SubAgentHandle>();
  const depthConfig = options?.subagentConfig ?? { currentDepth: 0, maxDepth: 1 };
  registry.register(createReadFileTool());
  registry.register(createWriteFileTool());
  registry.register(createEditFileTool());
  registry.register(
    createShellTool({ defaultTimeoutMs: 10_000, maxTimeoutMs: 600_000 }),
  );
  registry.register(createGrepTool());
  registry.register(createGlobTool());
  registry.register(createListDirTool());
  registry.register(createReadManyFilesTool());
  registry.register(createWebSearchTool());
  registry.register(createWebFetchTool());

  if (options?.sessionFactory) {
    registry.register(createSpawnAgentTool(options.sessionFactory, agents, depthConfig));
    registry.register(createSendInputTool(agents));
    registry.register(createWaitTool(agents));
    registry.register(createCloseAgentTool(agents));
  }

  return {
    id: "gemini",
    model,
    toolRegistry: registry,
    knowledgeCutoff: "March 2025",

    buildSystemPrompt(
      environment: ExecutionEnvironment,
      projectDocs: string,
      envOptions?: EnvironmentContextOptions,
      userInstructions?: string,
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
        userInstructions,
      );
    },

    tools(): ToolDefinition[] {
      return registry.definitions();
    },

    providerOptions(): Record<string, Record<string, unknown>> | null {
      return {
        gemini: {
          safety_settings: [
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE",
            },
          ],
          grounding: {
            google_search: true,
          },
        },
      };
    },

    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 1_000_000,
    subagentHandles: agents,
    subagentDepthConfig: depthConfig,
  };
}
