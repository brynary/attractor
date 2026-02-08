import type { ExecutionEnvironment, RegisteredTool, Turn } from "../types/index.js";

export interface SubAgentResult {
  output: string;
  success: boolean;
  turnsUsed: number;
}

export interface SubAgentHandle {
  id: string;
  status: "running" | "completed" | "failed";
  submit: (input: string) => Promise<void>;
  waitForCompletion: () => Promise<SubAgentResult>;
  close: () => Promise<void>;
  /** Optional: inspect subagent conversation history. */
  getHistory?: () => Turn[];
}

export type SessionFactory = (options: {
  task: string;
  workingDir?: string;
  model?: string;
  maxTurns?: number;
  depthConfig?: SubAgentDepthConfig;
  executionEnv?: ExecutionEnvironment;
}) => Promise<SubAgentHandle>;

export interface SubAgentDepthConfig {
  currentDepth: number;
  maxDepth: number;
}

export function createSpawnAgentTool(
  factory: SessionFactory,
  agents: Map<string, SubAgentHandle>,
  depthConfig?: SubAgentDepthConfig,
): RegisteredTool {
  return {
    definition: {
      name: "spawn_agent",
      description: "Spawn a subagent to work on a task independently.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description for the subagent" },
          working_dir: { type: "string", description: "Working directory for the subagent" },
          model: { type: "string", description: "Model to use for the subagent" },
          max_turns: {
            type: "integer",
            description: "Maximum turns for the subagent",
            default: 50,
          },
        },
        required: ["task"],
      },
    },
    executor: async (args, env) => {
      if (depthConfig && depthConfig.currentDepth >= depthConfig.maxDepth) {
        return `Error: Subagent spawning is disabled at depth ${depthConfig.currentDepth} (max depth: ${depthConfig.maxDepth})`;
      }

      const task = args.task as string;
      const workingDir = args.working_dir as string | undefined;
      const model = args.model as string | undefined;
      const maxTurns = (args.max_turns as number | undefined) ?? 50;

      const childDepth = depthConfig
        ? { currentDepth: depthConfig.currentDepth + 1, maxDepth: depthConfig.maxDepth }
        : undefined;
      const handle = await factory({ task, workingDir, model, maxTurns, depthConfig: childDepth, executionEnv: env });
      agents.set(handle.id, handle);
      return `Spawned agent ${handle.id} (status: ${handle.status})`;
    },
  };
}

export function createSendInputTool(
  agents: Map<string, SubAgentHandle>,
): RegisteredTool {
  return {
    definition: {
      name: "send_input",
      description: "Send a message to a running subagent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "ID of the subagent" },
          message: { type: "string", description: "Message to send" },
        },
        required: ["agent_id", "message"],
      },
    },
    executor: async (args) => {
      const agentId = args.agent_id as string;
      const message = args.message as string;

      const agent = agents.get(agentId);
      if (!agent) {
        return `Error: Unknown agent: ${agentId}`;
      }

      await agent.submit(message);
      return `Sent message to agent ${agentId}`;
    },
  };
}

export function createWaitTool(
  agents: Map<string, SubAgentHandle>,
): RegisteredTool {
  return {
    definition: {
      name: "wait",
      description: "Wait for a subagent to complete its task.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "ID of the subagent to wait for" },
        },
        required: ["agent_id"],
      },
    },
    executor: async (args) => {
      const agentId = args.agent_id as string;

      const agent = agents.get(agentId);
      if (!agent) {
        return `Error: Unknown agent: ${agentId}`;
      }

      const result = await agent.waitForCompletion();
      return `Agent ${agentId} completed (success: ${result.success}, turns: ${result.turnsUsed})\n\n${result.output}`;
    },
  };
}

export function createCloseAgentTool(
  agents: Map<string, SubAgentHandle>,
): RegisteredTool {
  return {
    definition: {
      name: "close_agent",
      description: "Close a subagent and free its resources.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "ID of the subagent to close" },
        },
        required: ["agent_id"],
      },
    },
    executor: async (args) => {
      const agentId = args.agent_id as string;

      const agent = agents.get(agentId);
      if (!agent) {
        return `Error: Unknown agent: ${agentId}`;
      }

      await agent.close();
      agents.delete(agentId);
      return `Closed agent ${agentId}`;
    },
  };
}
