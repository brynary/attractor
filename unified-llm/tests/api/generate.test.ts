import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { generate } from "../../src/api/generate.js";
import { Client } from "../../src/client/client.js";
import { setDefaultClient } from "../../src/client/default-client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { Response } from "../../src/types/response.js";
import { Role } from "../../src/types/role.js";
import { ConfigurationError } from "../../src/types/errors.js";

function makeResponse(
  text: string,
  finishReason: "stop" | "tool_calls" = "stop",
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [],
): Response {
  const content: Response["message"]["content"] = [];
  if (text) {
    content.push({ kind: "text", text });
  }
  for (const tc of toolCalls) {
    content.push({
      kind: "tool_call",
      toolCall: { ...tc, arguments: tc.arguments },
    });
  }
  return {
    id: "resp-1",
    model: "test-model",
    provider: "stub",
    message: { role: Role.ASSISTANT, content },
    finishReason: { reason: finishReason },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
  };
}

describe("generate", () => {
  let client: Client;

  function setup(adapter: StubAdapter): void {
    client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("simple generation with prompt", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("Hello world") },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "Say hello",
      client,
    });

    expect(result.text).toBe("Hello world");
    expect(result.finishReason.reason).toBe("stop");
    expect(result.steps).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.totalUsage.inputTokens).toBe(10);
  });

  test("generation with messages", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("Hi there") },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      messages: [
        { role: Role.USER, content: [{ kind: "text", text: "Hello" }] },
      ],
      client,
    });

    expect(result.text).toBe("Hi there");
    expect(adapter.calls).toHaveLength(1);
    const sentMessages = adapter.calls[0]?.messages;
    expect(sentMessages).toHaveLength(1);
  });

  test("generation with system message prepends it", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("OK") },
    ]);
    setup(adapter);

    await generate({
      model: "test-model",
      prompt: "Hello",
      system: "You are helpful",
      client,
    });

    const sentMessages = adapter.calls[0]?.messages;
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages?.[0]?.role).toBe(Role.SYSTEM);
    expect(sentMessages?.[1]?.role).toBe(Role.USER);
  });

  test("rejects when both prompt and messages provided", async () => {
    const adapter = new StubAdapter("stub", []);
    setup(adapter);

    await expect(
      generate({
        model: "test-model",
        prompt: "hello",
        messages: [
          { role: Role.USER, content: [{ kind: "text", text: "hi" }] },
        ],
        client,
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  test("tool loop: single round", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "get_weather", arguments: { city: "NYC" } },
        ]),
      },
      {
        response: makeResponse("The weather in NYC is sunny"),
      },
    ]);
    setup(adapter);

    let executeCalled = false;
    const result = await generate({
      model: "test-model",
      prompt: "What's the weather?",
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
          execute: async (args) => {
            executeCalled = true;
            return `Sunny in ${args["city"]}`;
          },
        },
      ],
      maxToolRounds: 1,
      client,
    });

    expect(executeCalled).toBe(true);
    expect(result.text).toBe("The weather in NYC is sunny");
    expect(result.steps).toHaveLength(2);
    expect(adapter.calls).toHaveLength(2);
  });

  test("tool loop: multiple rounds", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "step1", arguments: {} },
        ]),
      },
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-2", name: "step2", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Done"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "Do two steps",
      tools: [
        {
          name: "step1",
          description: "Step 1",
          parameters: {},
          execute: async () => "result1",
        },
        {
          name: "step2",
          description: "Step 2",
          parameters: {},
          execute: async () => "result2",
        },
      ],
      maxToolRounds: 3,
      client,
    });

    expect(result.text).toBe("Done");
    expect(result.steps).toHaveLength(3);
    expect(adapter.calls).toHaveLength(3);
  });

  test("tool loop respects maxToolRounds", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "loop_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-2", name: "loop_tool", arguments: {} },
        ]),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "loop",
      tools: [
        {
          name: "loop_tool",
          description: "Loops",
          parameters: {},
          execute: async () => "looped",
        },
      ],
      maxToolRounds: 1,
      client,
    });

    // Only 1 tool round allowed, so second response (still tool_calls) ends the loop
    expect(result.steps).toHaveLength(2);
    expect(adapter.calls).toHaveLength(2);
  });

  test("parallel tool execution", async () => {
    const executionOrder: string[] = [];

    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "tool_a", arguments: { id: "a" } },
          { id: "tc-2", name: "tool_b", arguments: { id: "b" } },
        ]),
      },
      {
        response: makeResponse("Both done"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "run both",
      tools: [
        {
          name: "tool_a",
          description: "A",
          parameters: {},
          execute: async () => {
            executionOrder.push("a");
            return "result_a";
          },
        },
        {
          name: "tool_b",
          description: "B",
          parameters: {},
          execute: async () => {
            executionOrder.push("b");
            return "result_b";
          },
        },
      ],
      client,
    });

    expect(executionOrder).toContain("a");
    expect(executionOrder).toContain("b");
    expect(result.steps[0]?.toolResults).toHaveLength(2);
  });

  test("tool execution error handling returns isError=true", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "failing_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("handled error"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use failing tool",
      tools: [
        {
          name: "failing_tool",
          description: "Fails",
          parameters: {},
          execute: async () => {
            throw new Error("Tool failed");
          },
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(true);
    expect(firstStep?.toolResults[0]?.content).toBe("Tool failed");
  });

  test("usage aggregation across steps", async () => {
    const resp1 = makeResponse("", "tool_calls", [
      { id: "tc-1", name: "tool", arguments: {} },
    ]);
    resp1.usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

    const resp2 = makeResponse("Final");
    resp2.usage = { inputTokens: 20, outputTokens: 10, totalTokens: 30 };

    const adapter = new StubAdapter("stub", [
      { response: resp1 },
      { response: resp2 },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "aggregate",
      tools: [
        {
          name: "tool",
          description: "A tool",
          parameters: {},
          execute: async () => "ok",
        },
      ],
      client,
    });

    expect(result.totalUsage.inputTokens).toBe(30);
    expect(result.totalUsage.outputTokens).toBe(15);
    expect(result.totalUsage.totalTokens).toBe(45);
    // Last step usage should be just the last response
    expect(result.usage.inputTokens).toBe(20);
  });
});
