import type { ToolDefinition } from "unified-llm";
import type { ExecutionEnvironment, EnvironmentContextOptions } from "../types/index.js";
import type { ProviderProfile } from "../types/index.js";
import { ToolRegistry } from "../types/index.js";
import {
  createReadFileTool,
  createWriteFileTool,
  createShellTool,
  createGrepTool,
  createGlobTool,
} from "../tools/core-tools.js";
import { createApplyPatchTool } from "../tools/apply-patch.js";
import type { SessionFactory, SubAgentDepthConfig } from "../tools/subagent-tools.js";
import {
  createSpawnAgentTool,
  createSendInputTool,
  createWaitTool,
  createCloseAgentTool,
} from "../tools/subagent-tools.js";
import type { SubAgentHandle } from "../tools/subagent-tools.js";
import { OPENAI_BASE_PROMPT } from "./prompts/openai-base.js";
import {
  buildEnvironmentContext,
  buildSystemPrompt,
} from "./system-prompt.js";

export function createOpenAIProfile(
  model: string,
  options?: {
    sessionFactory?: SessionFactory;
    subagentConfig?: SubAgentDepthConfig;
    basePrompt?: string;
  },
): ProviderProfile {
  const registry = new ToolRegistry();
  const agents = new Map<string, SubAgentHandle>();
  const depthConfig = options?.subagentConfig ?? { currentDepth: 0, maxDepth: 1 };
  registry.register(createReadFileTool());
  registry.register(createWriteFileTool());
  registry.register(createApplyPatchTool());
  registry.register(
    createShellTool({ defaultTimeoutMs: 10_000, maxTimeoutMs: 600_000 }),
  );
  registry.register(createGrepTool());
  registry.register(createGlobTool());

  if (options?.sessionFactory) {
    registry.register(createSpawnAgentTool(options.sessionFactory, agents, depthConfig));
    registry.register(createSendInputTool(agents));
    registry.register(createWaitTool(agents));
    registry.register(createCloseAgentTool(agents));
  }

  return {
    id: "openai",
    model,
    toolRegistry: registry,
    knowledgeCutoff: "June 2025",

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
        options?.basePrompt ?? OPENAI_BASE_PROMPT,
        envContext,
        toolDescs,
        projectDocs,
        userInstructions,
      );
    },

    tools(): ToolDefinition[] {
      return registry.definitions();
    },

    // reasoningEffort is passed via Request.reasoningEffort, which the
    // OpenAI request translator maps to body.reasoning.effort directly.
    providerOptions(): Record<string, Record<string, unknown>> | null {
      return null;
    },

    supportsReasoning: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    contextWindowSize: 200_000,
    subagentHandles: agents,
    subagentDepthConfig: depthConfig,
    subagentSessionFactory: options?.sessionFactory,
  };
}
