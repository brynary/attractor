import { describe, test, expect } from "bun:test";
import { stream } from "../../src/api/stream.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import { ServerError, AuthenticationError, RequestTimeoutError, ConfigurationError, UnsupportedToolChoiceError } from "../../src/types/errors.js";

function makeStreamEvents(text: string): StreamEvent[] {
  return [
    { type: StreamEventType.STREAM_START, model: "test-model" },
    { type: StreamEventType.TEXT_START },
    { type: StreamEventType.TEXT_DELTA, delta: text },
    { type: StreamEventType.TEXT_END },
    {
      type: StreamEventType.FINISH,
      finishReason: { reason: "stop" },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
  ];
}

describe("stream", () => {
  function makeClient(adapter: StubAdapter): Client {
    return new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });
  }

  test("simple streaming yields all events", async () => {
    const events = makeStreamEvents("Hello world");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "Say hello",
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    expect(collected).toHaveLength(5);
    expect(collected[0]?.type).toBe(StreamEventType.STREAM_START);
    expect(collected[2]?.type).toBe(StreamEventType.TEXT_DELTA);
  });

  test("textStream yields only text deltas", async () => {
    const events = makeStreamEvents("Hello");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    const texts: string[] = [];
    for await (const text of result.textStream) {
      texts.push(text);
    }

    expect(texts).toEqual(["Hello"]);
  });

  test("response() returns accumulated response", async () => {
    const events = makeStreamEvents("Accumulated");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    const response = await result.response();
    expect(response.finishReason.reason).toBe("stop");
    expect(response.usage.inputTokens).toBe(10);
    // Check accumulated text
    const textPart = response.message.content.find((c) => c.kind === "text");
    expect(textPart).toBeDefined();
    if (textPart && textPart.kind === "text") {
      expect(textPart.text).toBe("Accumulated");
    }
  });

  test("response() works when called before iteration", async () => {
    const events = makeStreamEvents("Auto");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    // Call response() without iterating first - should auto-consume
    const response = await result.response();
    expect(response.finishReason.reason).toBe("stop");
  });

  test("streaming with multiple text deltas", async () => {
    const events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      { type: StreamEventType.TEXT_START },
      { type: StreamEventType.TEXT_DELTA, delta: "Hello " },
      { type: StreamEventType.TEXT_DELTA, delta: "world" },
      { type: StreamEventType.TEXT_END },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    const texts: string[] = [];
    for await (const text of result.textStream) {
      texts.push(text);
    }

    expect(texts).toEqual(["Hello ", "world"]);
  });

  test("partialResponse returns current state", async () => {
    const events = makeStreamEvents("partial");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    // Before any iteration, partialResponse should return empty response
    const partial = result.partialResponse;
    expect(partial.finishReason.reason).toBe("other");

    // Consume stream fully
    await result.response();
  });

  test("FINISH event includes response object", async () => {
    const events = makeStreamEvents("with-response");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    const finish = collected.find((e) => e.type === StreamEventType.FINISH);
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.response).toBeDefined();
      expect(finish.response?.finishReason.reason).toBe("stop");
    }
  });

  test("retries on retryable connection error then succeeds", async () => {
    const events = makeStreamEvents("retried");
    const adapter = new StubAdapter("stub", [
      { error: new ServerError("server down", "stub") },
      { events },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
      maxRetries: 2,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    expect(collected).toHaveLength(5);
    expect(adapter.calls).toHaveLength(2);
  });

  test("does not retry on non-retryable error", async () => {
    const adapter = new StubAdapter("stub", [
      { error: new AuthenticationError("bad key", "stub") },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
      maxRetries: 2,
    });

    await expect(async () => {
      for await (const _event of result) {
        // should not reach here
      }
    }).toThrow("bad key");

    expect(adapter.calls).toHaveLength(1);
  });

  test("stopWhen stops tool loop after condition met", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "my_tool",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: "{}",
      },
      {
        type: StreamEventType.TOOL_CALL_END,
        toolCallId: "tc-1",
      },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const finalEvents = makeStreamEvents("Done");

    const adapter = new StubAdapter("stub", [
      { events: toolCallEvents },
      { events: toolCallEvents },
      { events: finalEvents },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "do stuff",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: {},
          execute: async () => "ok",
        },
      ],
      maxToolRounds: 5,
      stopWhen: (steps) => steps.length >= 1,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Should only have made 1 LLM call because stopWhen stopped after first tool round
    expect(adapter.calls).toHaveLength(1);
  });

  test("throws after max retries exhausted", async () => {
    const adapter = new StubAdapter("stub", [
      { error: new ServerError("fail 1", "stub") },
      { error: new ServerError("fail 2", "stub") },
      { error: new ServerError("fail 3", "stub") },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
      maxRetries: 2,
    });

    await expect(async () => {
      for await (const _event of result) {
        // should not reach here
      }
    }).toThrow("fail 3");

    expect(adapter.calls).toHaveLength(3);
  });

  test("stopWhen emits FINISH event before stopping", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "my_tool",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: "{}",
      },
      {
        type: StreamEventType.TOOL_CALL_END,
        toolCallId: "tc-1",
      },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const adapter = new StubAdapter("stub", [
      { events: toolCallEvents },
      { events: toolCallEvents },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "do stuff",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: {},
          execute: async () => "ok",
        },
      ],
      maxToolRounds: 5,
      stopWhen: (steps) => steps.length >= 1,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Should have a FINISH event emitted by the stopWhen path
    const finishEvents = collected.filter((e) => e.type === StreamEventType.FINISH);
    expect(finishEvents.length).toBeGreaterThanOrEqual(1);
    const lastFinish = finishEvents[finishEvents.length - 1];
    if (lastFinish?.type === StreamEventType.FINISH) {
      expect(lastFinish.response).toBeDefined();
    }
  });

  test("rejects tool parameters without root type object", () => {
    const adapter = new StubAdapter("stub", []);
    const client = makeClient(adapter);

    expect(() =>
      stream({
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
    ).toThrow(ConfigurationError);
  });

  test("throws UnsupportedToolChoiceError when adapter rejects mode", () => {
    const adapter = new StubAdapter("stub", []);
    adapter.supportsToolChoice = (mode: string) => mode !== "required";
    const client = makeClient(adapter);

    expect(() =>
      stream({
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
    ).toThrow(UnsupportedToolChoiceError);
  });

  test("abortSignal is passed to adapter request", async () => {
    const events = makeStreamEvents("Hello");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const controller = new AbortController();
    const result = stream({
      model: "test-model",
      prompt: "hello",
      abortSignal: controller.signal,
      client,
    });

    for await (const _event of result) {
      // consume
    }

    expect(adapter.calls[0]?.abortSignal).toBe(controller.signal);
  });

  test("total timeout throws RequestTimeoutError", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "slow_tool",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: "{}",
      },
      {
        type: StreamEventType.TOOL_CALL_END,
        toolCallId: "tc-1",
      },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const finalEvents = makeStreamEvents("Done");

    const adapter = new StubAdapter("stub", [
      { events: toolCallEvents },
      { events: finalEvents },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "run slow tool",
      tools: [
        {
          name: "slow_tool",
          description: "A slow tool",
          parameters: {},
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return "ok";
          },
        },
      ],
      maxToolRounds: 3,
      timeout: { total: 50 },
      client,
    });

    await expect(async () => {
      for await (const _event of result) {
        // consume
      }
    }).toThrow(RequestTimeoutError);
  });

  test("timeout config passed to adapter", async () => {
    const adapter = new StubAdapter("stub", [
      { events: makeStreamEvents("ok") },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "test",
      timeout: 15000,
      client,
    });

    for await (const _event of result) {
      // consume
    }

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toBeDefined();
    expect(adapter.calls[0]?.timeout?.request).toBe(15000);
    expect(adapter.calls[0]?.timeout?.connect).toBe(10_000);
  });

  test("timeout with per-step config passed to adapter", async () => {
    const adapter = new StubAdapter("stub", [
      { events: makeStreamEvents("ok") },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "test",
      timeout: { perStep: 20000 },
      client,
    });

    for await (const _event of result) {
      // consume
    }

    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.timeout).toBeDefined();
    expect(adapter.calls[0]?.timeout?.request).toBe(20000);
  });
});
