import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { generate } from "../../src/api/generate.js";
import { Client } from "../../src/client/client.js";
import { setDefaultClient } from "../../src/client/default-client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { Response } from "../../src/types/response.js";
import { Role } from "../../src/types/role.js";
import { ConfigurationError, RequestTimeoutError, UnsupportedToolChoiceError } from "../../src/types/errors.js";
import { getLatestModel } from "../../src/models/catalog.js";

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

  test("defaults to latest model when model is omitted", async () => {
    const latest = getLatestModel("openai");
    expect(latest).toBeDefined();
    const adapter = new StubAdapter("openai", [
      { response: makeResponse("Hello world") },
    ]);
    client = new Client({
      providers: { openai: adapter },
      defaultProvider: "openai",
    });

    await generate({
      prompt: "Say hello",
      client,
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.model).toBe(latest?.id);
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

  test("passes metadata through to adapter requests", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("Hi there") },
    ]);
    setup(adapter);

    await generate({
      model: "test-model",
      prompt: "hello",
      metadata: { traceId: "trace-123", tenant: "acme" },
      client,
    });

    expect(adapter.calls[0]?.metadata).toEqual({
      traceId: "trace-123",
      tenant: "acme",
    });
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

  test("rejects when neither prompt nor messages is provided", async () => {
    const adapter = new StubAdapter("stub", []);
    setup(adapter);

    await expect(
      generate({
        model: "test-model",
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
          parameters: { type: "object" },
          execute: async () => "result1",
        },
        {
          name: "step2",
          description: "Step 2",
          parameters: { type: "object" },
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
          parameters: { type: "object" },
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
          parameters: { type: "object" },
          execute: async () => {
            executionOrder.push("a");
            return "result_a";
          },
        },
        {
          name: "tool_b",
          description: "B",
          parameters: { type: "object" },
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
          parameters: { type: "object" },
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
          parameters: { type: "object" },
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

  test("tool argument validation returns error on schema mismatch", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "typed_tool", arguments: { count: "not-a-number" } },
        ]),
      },
      {
        response: makeResponse("handled validation error"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use typed tool",
      tools: [
        {
          name: "typed_tool",
          description: "Needs a number",
          parameters: { type: "object", properties: { count: { type: "number" } } },
          execute: async () => "should not be called",
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(true);
    expect(firstStep?.toolResults[0]?.content).toContain("Tool argument validation failed");
  });

  test("tool argument validation passes for valid args", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "typed_tool", arguments: { count: 42 } },
        ]),
      },
      {
        response: makeResponse("success"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use typed tool",
      tools: [
        {
          name: "typed_tool",
          description: "Needs a number",
          parameters: { type: "object", properties: { count: { type: "number" } } },
          execute: async () => "executed",
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(false);
    expect(firstStep?.toolResults[0]?.content).toBe("executed");
  });

  test("repairToolCall fixes invalid arguments", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "typed_tool", arguments: { count: "bad" } },
        ]),
      },
      {
        response: makeResponse("repaired"),
      },
    ]);
    setup(adapter);

    let repairCalled = false;
    const result = await generate({
      model: "test-model",
      prompt: "use typed tool",
      tools: [
        {
          name: "typed_tool",
          description: "Needs a number",
          parameters: { type: "object", properties: { count: { type: "number" } } },
          execute: async (args) => `count=${args["count"]}`,
        },
      ],
      repairToolCall: async (_toolCall, _error) => {
        repairCalled = true;
        return { count: 99 };
      },
      client,
    });

    expect(repairCalled).toBe(true);
    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(false);
    expect(firstStep?.toolResults[0]?.content).toBe("count=99");
  });

  test("execute receives ToolExecutionContext", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "ctx_tool", arguments: { x: 1 } },
        ]),
      },
      {
        response: makeResponse("done"),
      },
    ]);
    setup(adapter);

    let receivedContext: unknown;
    await generate({
      model: "test-model",
      prompt: "use ctx tool",
      tools: [
        {
          name: "ctx_tool",
          description: "Receives context",
          parameters: { type: "object", properties: { x: { type: "number" } } },
          execute: async (_args, context) => {
            receivedContext = context;
            return "ok";
          },
        },
      ],
      client,
    });

    expect(receivedContext).toBeDefined();
    const ctx = receivedContext as { toolCallId: string; messages: unknown[] };
    expect(ctx.toolCallId).toBe("tc-1");
    expect(Array.isArray(ctx.messages)).toBe(true);
  });

  test("retryPolicy option is used instead of maxRetries", async () => {
    let retryCalled = false;
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("success") },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "hello",
      retryPolicy: {
        maxRetries: 0,
        baseDelay: 0.001,
        maxDelay: 1.0,
        backoffMultiplier: 1.0,
        jitter: false,
        onRetry: () => { retryCalled = true; },
      },
      client,
    });

    expect(result.text).toBe("success");
    expect(retryCalled).toBe(false);
  });

  test("rejects tool parameters without root type object", async () => {
    const adapter = new StubAdapter("stub", []);
    setup(adapter);

    await expect(
      generate({
        model: "test-model",
        prompt: "hello",
        tools: [
          {
            name: "bad_tool",
            description: "Bad params",
            parameters: { type: "array", items: { type: "string" } },
          },
        ],
        client,
      }),
    ).rejects.toThrow(ConfigurationError);
  });

  test("accepts tool parameters with root type object", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "hello",
      tools: [
        {
          name: "empty_tool",
          description: "Empty params",
          parameters: { type: "object" },
          execute: async () => "done",
        },
      ],
      client,
    });

    expect(result.text).toBe("ok");
  });

  test("throws UnsupportedToolChoiceError when adapter rejects mode", async () => {
    const adapter = new StubAdapter("stub", []);
    adapter.supportsToolChoice = (mode: string) => mode !== "required";
    setup(adapter);

    await expect(
      generate({
        model: "test-model",
        prompt: "hello",
        tools: [
          {
            name: "my_tool",
            description: "A tool",
            parameters: { type: "object" },
          },
        ],
        toolChoice: { mode: "required" },
        client,
      }),
    ).rejects.toThrow(UnsupportedToolChoiceError);
  });

  test("allows toolChoice when adapter supports the mode", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    adapter.supportsToolChoice = () => true;
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "hello",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: { type: "object" },
        },
      ],
      toolChoice: { mode: "auto" },
      client,
    });

    expect(result.text).toBe("ok");
  });

  test("allows toolChoice when adapter has no supportsToolChoice method", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "hello",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: { type: "object" },
        },
      ],
      toolChoice: { mode: "auto" },
      client,
    });

    expect(result.text).toBe("ok");
  });

  test("abortSignal is passed to adapter request", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    setup(adapter);

    const controller = new AbortController();
    await generate({
      model: "test-model",
      prompt: "hello",
      abortSignal: controller.signal,
      client,
    });

    expect(adapter.calls[0]?.abortSignal).toBe(controller.signal);
  });

  test("abortSignal is passed to tool execution context", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "sig_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("done"),
      },
    ]);
    setup(adapter);

    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    await generate({
      model: "test-model",
      prompt: "use tool",
      tools: [
        {
          name: "sig_tool",
          description: "Receives signal",
          parameters: { type: "object" },
          execute: async (_args, context) => {
            receivedSignal = context?.abortSignal;
            return "ok";
          },
        },
      ],
      abortSignal: controller.signal,
      client,
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  test("pre-aborted signal rejects generate", async () => {
    const adapter = new StubAdapter("stub", []);
    setup(adapter);

    const controller = new AbortController();
    controller.abort();

    await expect(
      generate({
        model: "test-model",
        prompt: "hello",
        abortSignal: controller.signal,
        client,
      }),
    ).rejects.toThrow();
  });

  test("total timeout throws RequestTimeoutError", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "slow_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Done"),
      },
    ]);
    setup(adapter);

    await expect(
      generate({
        model: "test-model",
        prompt: "run slow tool",
        tools: [
          {
            name: "slow_tool",
            description: "A slow tool",
            parameters: { type: "object" },
            execute: async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              return "ok";
            },
          },
        ],
        maxToolRounds: 3,
        timeout: { total: 50 },
        client,
      }),
    ).rejects.toThrow(RequestTimeoutError);
  });

  test("timeout config passed to adapter", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    setup(adapter);

    await generate({
      model: "test-model",
      prompt: "test",
      timeout: 15000,
      client,
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toBeDefined();
    expect(adapter.calls[0]?.timeout?.request).toBe(15000);
    expect(adapter.calls[0]?.timeout?.connect).toBe(10_000);
  });

  test("timeout with per-step config passed to adapter", async () => {
    const adapter = new StubAdapter("stub", [
      { response: makeResponse("ok") },
    ]);
    setup(adapter);

    await generate({
      model: "test-model",
      prompt: "test",
      timeout: { perStep: 20000 },
      client,
    });

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toBeDefined();
    expect(adapter.calls[0]?.timeout?.request).toBe(20000);
  });

  test("passive tools (no execute handler) break tool loop", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "passive_tool", arguments: { query: "test" } },
        ]),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use passive tool",
      tools: [
        {
          name: "passive_tool",
          description: "A passive tool without execute handler",
          parameters: { type: "object", properties: { query: { type: "string" } } },
          // No execute handler - this is passive
        },
      ],
      maxToolRounds: 3,
      client,
    });

    // Should only make one LLM call, then stop because passive tools don't auto-execute
    expect(adapter.calls).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("passive_tool");
    expect(result.toolResults).toHaveLength(0); // No tool results because not executed
  });

  test("mixed passive and active tools: passive breaks loop", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "active_tool", arguments: {} },
          { id: "tc-2", name: "passive_tool", arguments: {} },
        ]),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use both tools",
      tools: [
        {
          name: "active_tool",
          description: "Active",
          parameters: { type: "object" },
          execute: async () => "executed",
        },
        {
          name: "passive_tool",
          description: "Passive",
          parameters: { type: "object" },
          // No execute handler
        },
      ],
      maxToolRounds: 3,
      client,
    });

    // Should stop after first response because passive tool is present
    expect(adapter.calls).toHaveLength(1);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolResults).toHaveLength(0); // Loop breaks before execution
  });

  test("unknown tool calls receive error results", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "known_tool", arguments: {} },
          { id: "tc-2", name: "unknown_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Handled errors"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "use tools",
      tools: [
        {
          name: "known_tool",
          description: "Known",
          parameters: { type: "object" },
          execute: async () => "ok",
        },
      ],
      maxToolRounds: 2,
      client,
    });

    expect(result.steps).toHaveLength(2);
    const firstStep = result.steps[0];
    expect(firstStep?.toolResults).toHaveLength(2);

    // Known tool should succeed
    const knownResult = firstStep?.toolResults.find((r) => r.toolCallId === "tc-1");
    expect(knownResult?.isError).toBe(false);
    expect(knownResult?.content).toBe("ok");

    // Unknown tool should get error
    const unknownResult = firstStep?.toolResults.find((r) => r.toolCallId === "tc-2");
    expect(unknownResult?.isError).toBe(true);
    expect(unknownResult?.content).toContain("not found");
  });

  test("tool execute returns object content", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "data_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Got data"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "get data",
      tools: [
        {
          name: "data_tool",
          description: "Returns structured data",
          parameters: { type: "object" },
          execute: async () => ({ name: "Alice", age: 30, active: true }),
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(false);
    expect(firstStep?.toolResults[0]?.content).toEqual({ name: "Alice", age: 30, active: true });
  });

  test("tool execute returns array content", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "list_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Got list"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "get list",
      tools: [
        {
          name: "list_tool",
          description: "Returns array",
          parameters: { type: "object" },
          execute: async () => ["item1", "item2", "item3"],
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(false);
    expect(firstStep?.toolResults[0]?.content).toEqual(["item1", "item2", "item3"]);
  });

  test("tool execute returns number coerced to string", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "num_tool", arguments: {} },
        ]),
      },
      {
        response: makeResponse("Got number"),
      },
    ]);
    setup(adapter);

    const result = await generate({
      model: "test-model",
      prompt: "get number",
      tools: [
        {
          name: "num_tool",
          description: "Returns number",
          parameters: { type: "object" },
          execute: async () => 42,
        },
      ],
      client,
    });

    const firstStep = result.steps[0];
    expect(firstStep?.toolResults[0]?.isError).toBe(false);
    expect(firstStep?.toolResults[0]?.content).toBe("42");
  });

  test("three-round tool loop with different tools each round", async () => {
    const adapter = new StubAdapter("stub", [
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-1", name: "tool_a", arguments: {} },
        ]),
      },
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-2", name: "tool_b", arguments: {} },
        ]),
      },
      {
        response: makeResponse("", "tool_calls", [
          { id: "tc-3", name: "tool_c", arguments: {} },
        ]),
      },
      {
        response: makeResponse("All done"),
      },
    ]);
    setup(adapter);

    let executionOrder: string[] = [];
    const result = await generate({
      model: "test-model",
      prompt: "do three steps",
      tools: [
        {
          name: "tool_a",
          description: "A",
          parameters: { type: "object" },
          execute: async () => { executionOrder.push("a"); return "result_a"; },
        },
        {
          name: "tool_b",
          description: "B",
          parameters: { type: "object" },
          execute: async () => { executionOrder.push("b"); return "result_b"; },
        },
        {
          name: "tool_c",
          description: "C",
          parameters: { type: "object" },
          execute: async () => { executionOrder.push("c"); return "result_c"; },
        },
      ],
      maxToolRounds: 3,
      client,
    });

    expect(result.steps).toHaveLength(4);
    expect(executionOrder).toEqual(["a", "b", "c"]);
    expect(result.text).toBe("All done");
  });
});
