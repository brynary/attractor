import { describe, test, expect } from "bun:test";
import { StubExecutionEnvironment } from "../stubs/stub-env.js";
import type { ExecutionEnvironment } from "../../src/types/index.js";
import type { SubAgentHandle, SessionFactory, SubAgentDepthConfig } from "../../src/tools/subagent-tools.js";
import {
  createSpawnAgentTool,
  createSendInputTool,
  createWaitTool,
  createCloseAgentTool,
} from "../../src/tools/subagent-tools.js";

interface FactoryOptions {
  task: string;
  workingDir?: string;
  model?: string;
  maxTurns?: number;
  depthConfig?: SubAgentDepthConfig;
  executionEnv?: ExecutionEnvironment;
}

function createMockFactory(): {
  factory: SessionFactory;
  lastOptions: FactoryOptions | null;
  handle: SubAgentHandle;
} {
  const submitted: string[] = [];
  const handle: SubAgentHandle = {
    id: "agent-1",
    status: "running",
    submit: async (input: string) => {
      submitted.push(input);
    },
    waitForCompletion: async () => ({
      output: "Task completed successfully",
      success: true,
      turnsUsed: 5,
    }),
    close: async () => {
      handle.status = "completed";
    },
  };

  let lastOptions: FactoryOptions | null = null;

  const factory: SessionFactory = async (options) => {
    lastOptions = options;
    return handle;
  };

  return { factory, get lastOptions() { return lastOptions; }, handle };
}

describe("spawn_agent", () => {
  test("calls factory and returns agent id", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { factory } = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(factory, agents);

    const result = await tool.executor({ task: "fix the bug" }, env);
    expect(result).toContain("agent-1");
    expect(result).toContain("running");
    expect(agents.has("agent-1")).toBe(true);
  });

  test("depth at limit returns error result", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { factory } = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(factory, agents, { currentDepth: 2, maxDepth: 2 });

    const result = await tool.executor({ task: "fix the bug" }, env);
    expect(result).toContain("Error");
    expect(result).toContain("disabled at depth 2");
    expect(agents.has("agent-1")).toBe(false);
  });

  test("depth below limit spawns normally", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { factory } = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(factory, agents, { currentDepth: 0, maxDepth: 2 });

    const result = await tool.executor({ task: "fix the bug" }, env);
    expect(result).toContain("agent-1");
    expect(result).toContain("running");
    expect(agents.has("agent-1")).toBe(true);
  });

  test("propagates incremented depth to child session", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const mock = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(mock.factory, agents, { currentDepth: 1, maxDepth: 3 });

    await tool.executor({ task: "subtask" }, env);
    expect(mock.lastOptions?.depthConfig).toEqual({ currentDepth: 2, maxDepth: 3 });
  });

  test("passes undefined depthConfig when no parent depth", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const mock = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(mock.factory, agents);

    await tool.executor({ task: "subtask" }, env);
    expect(mock.lastOptions?.depthConfig).toBeUndefined();
  });

  test("passes parent executionEnv to factory", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const mock = createMockFactory();
    const env = new StubExecutionEnvironment();
    const tool = createSpawnAgentTool(mock.factory, agents);

    await tool.executor({ task: "subtask" }, env);
    expect(mock.lastOptions?.executionEnv).toBe(env);
  });
});

describe("send_input", () => {
  test("sends message to correct agent", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { handle } = createMockFactory();
    agents.set("agent-1", handle);
    const env = new StubExecutionEnvironment();
    const tool = createSendInputTool(agents);

    const result = await tool.executor(
      { agent_id: "agent-1", message: "do more work" },
      env,
    );
    expect(result).toContain("Sent message to agent agent-1");
  });

  test("returns error string for unknown agent", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const env = new StubExecutionEnvironment();
    const tool = createSendInputTool(agents);

    const result = await tool.executor(
      { agent_id: "no-such-agent", message: "hello" },
      env,
    );
    expect(result).toBe("Error: Unknown agent: no-such-agent");
  });
});

describe("wait", () => {
  test("returns completion result", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { handle } = createMockFactory();
    agents.set("agent-1", handle);
    const env = new StubExecutionEnvironment();
    const tool = createWaitTool(agents);

    const result = await tool.executor({ agent_id: "agent-1" }, env);
    expect(result).toContain("completed");
    expect(result).toContain("success: true");
    expect(result).toContain("turns: 5");
    expect(result).toContain("Task completed successfully");
  });

  test("returns error string for unknown agent", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const env = new StubExecutionEnvironment();
    const tool = createWaitTool(agents);

    const result = await tool.executor({ agent_id: "no-such-agent" }, env);
    expect(result).toBe("Error: Unknown agent: no-such-agent");
  });
});

describe("close_agent", () => {
  test("closes agent and removes from map", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const { handle } = createMockFactory();
    agents.set("agent-1", handle);
    const env = new StubExecutionEnvironment();
    const tool = createCloseAgentTool(agents);

    const result = await tool.executor({ agent_id: "agent-1" }, env);
    expect(result).toContain("Closed agent agent-1");
    expect(agents.has("agent-1")).toBe(false);
  });

  test("returns error string for unknown agent", async () => {
    const agents = new Map<string, SubAgentHandle>();
    const env = new StubExecutionEnvironment();
    const tool = createCloseAgentTool(agents);

    const result = await tool.executor({ agent_id: "no-such-agent" }, env);
    expect(result).toBe("Error: Unknown agent: no-such-agent");
  });
});
