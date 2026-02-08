import { describe, test, expect } from "bun:test";
import { stream } from "../../src/api/stream.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import {
  AbortError,
  ServerError,
  AuthenticationError,
  RequestTimeoutError,
  ConfigurationError,
  UnsupportedToolChoiceError,
  StreamError,
} from "../../src/types/errors.js";
import { getLatestModel } from "../../src/models/catalog.js";

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

  test("defaults to latest model when model is omitted", async () => {
    const latest = getLatestModel("openai");
    expect(latest).toBeDefined();
    const adapter = new StubAdapter("openai", [{ events: makeStreamEvents("Hello") }]);
    const client = new Client({
      providers: { openai: adapter },
      defaultProvider: "openai",
    });

    const result = stream({
      prompt: "hello",
      client,
    });

    await result.response();
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]?.model).toBe(latest?.id);
  });

  test("rejects when both prompt and messages are provided", () => {
    const adapter = new StubAdapter("stub", []);
    const client = makeClient(adapter);

    expect(() =>
      stream({
        model: "test-model",
        prompt: "hello",
        messages: [{ role: "user", content: [{ kind: "text", text: "hi" }] }],
        client,
      }),
    ).toThrow(ConfigurationError);
  });

  test("rejects when neither prompt nor messages is provided", () => {
    const adapter = new StubAdapter("stub", []);
    const client = makeClient(adapter);

    expect(() =>
      stream({
        model: "test-model",
        client,
      }),
    ).toThrow(ConfigurationError);
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
    expect(response.provider).toBe("stub");
    // Check accumulated text
    const textPart = response.message.content.find((c) => c.kind === "text");
    expect(textPart).toBeDefined();
    if (textPart && textPart.kind === "text") {
      expect(textPart.text).toBe("Accumulated");
    }
  });

  test("passes metadata through to adapter requests", async () => {
    const events = makeStreamEvents("meta");
    const adapter = new StubAdapter("stub", [{ events }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "hello",
      metadata: { traceId: "trace-123", tenant: "acme" },
      client,
    });

    await result.response();
    expect(adapter.calls[0]?.metadata).toEqual({
      traceId: "trace-123",
      tenant: "acme",
    });
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
          parameters: { type: "object" },
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

  test("emits ERROR event when stream fails after partial output", async () => {
    const adapter = {
      name: "stub",
      async complete() {
        throw new Error("not used");
      },
      async *stream(): AsyncGenerator<StreamEvent> {
        yield { type: StreamEventType.STREAM_START, model: "test-model" };
        yield { type: StreamEventType.TEXT_START };
        yield { type: StreamEventType.TEXT_DELTA, delta: "hello" };
        throw new Error("stream exploded");
      },
    };
    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    const errorEvent = collected.find((e) => e.type === StreamEventType.ERROR);
    expect(errorEvent?.type).toBe(StreamEventType.ERROR);
    if (errorEvent?.type === StreamEventType.ERROR) {
      expect(errorEvent.error).toBeInstanceOf(StreamError);
      expect(errorEvent.error.message).toContain("stream exploded");
    }
  });

  test("throws AbortError when stream is cancelled", async () => {
    const adapter = {
      name: "stub",
      async complete() {
        throw new Error("not used");
      },
      async *stream(): AsyncGenerator<StreamEvent> {
        yield { type: StreamEventType.STREAM_START, model: "test-model" };
        throw new AbortError("Request was aborted");
      },
    };
    const client = new Client({
      providers: { stub: adapter },
      defaultProvider: "stub",
    });

    const result = stream({
      model: "test-model",
      prompt: "hello",
      client,
    });

    await expect(async () => {
      for await (const _event of result) {
        // consume
      }
    }).toThrow(AbortError);
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
          parameters: { type: "object" },
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

  test("passive tools break streaming tool loop", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "passive_tool",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-1",
        argumentsDelta: '{"q":"test"}',
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

    const adapter = new StubAdapter("stub", [{ events: toolCallEvents }]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "use passive tool",
      tools: [
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

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Should only make one LLM call, loop breaks on passive tool
    expect(adapter.calls).toHaveLength(1);
    expect(collected.filter((e) => e.type === StreamEventType.TOOL_CALL_START)).toHaveLength(1);
  });

  test("STEP_FINISH event emitted after tool execution", async () => {
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
      { events: finalEvents },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "use tool",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: { type: "object" },
          execute: async () => "result",
        },
      ],
      maxToolRounds: 2,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Should have a STEP_FINISH event after tool execution
    const stepFinishEvents = collected.filter((e) => e.type === StreamEventType.STEP_FINISH);
    expect(stepFinishEvents).toHaveLength(1);

    // STEP_FINISH should come before the second STREAM_START
    const stepFinishIndex = collected.findIndex((e) => e.type === StreamEventType.STEP_FINISH);
    const secondStreamStart = collected.findIndex(
      (e, i) => i > 0 && e.type === StreamEventType.STREAM_START,
    );
    expect(stepFinishIndex).toBeGreaterThan(-1);
    expect(secondStreamStart).toBeGreaterThan(stepFinishIndex);
  });

  test("emits only one final FINISH event across multi-round tool streaming", async () => {
    const round1Events: StreamEvent[] = [
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

    const round2Events = makeStreamEvents("Done");
    const adapter = new StubAdapter("stub", [
      { events: round1Events },
      { events: round2Events },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "use tool",
      tools: [
        {
          name: "my_tool",
          description: "A tool",
          parameters: { type: "object" },
          execute: async () => "result",
        },
      ],
      maxToolRounds: 2,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    const stepFinishEvents = collected.filter((e) => e.type === StreamEventType.STEP_FINISH);
    expect(stepFinishEvents).toHaveLength(1);
    const finishEvents = collected.filter((e) => e.type === StreamEventType.FINISH);
    expect(finishEvents).toHaveLength(1);
    const finish = finishEvents[0];
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason.reason).toBe("stop");
      const textPart = finish.response?.message.content.find((p) => p.kind === "text");
      expect(textPart).toBeDefined();
      if (textPart?.kind === "text") {
        expect(textPart.text).toBe("Done");
      }
    }
  });

  test("unknown tools receive error results in streaming", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "known_tool",
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
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-2",
        toolName: "unknown_tool",
      },
      {
        type: StreamEventType.TOOL_CALL_DELTA,
        toolCallId: "tc-2",
        argumentsDelta: "{}",
      },
      {
        type: StreamEventType.TOOL_CALL_END,
        toolCallId: "tc-2",
      },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ];

    const finalEvents = makeStreamEvents("Handled");

    const adapter = new StubAdapter("stub", [
      { events: toolCallEvents },
      { events: finalEvents },
    ]);
    const client = makeClient(adapter);

    let knownToolCalled = false;
    const result = stream({
      model: "test-model",
      prompt: "use tools",
      tools: [
        {
          name: "known_tool",
          description: "Known",
          parameters: { type: "object" },
          execute: async () => {
            knownToolCalled = true;
            return "ok";
          },
        },
      ],
      maxToolRounds: 2,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Known tool should be executed
    expect(knownToolCalled).toBe(true);

    // Should complete the loop (unknown tool gets error, model responds)
    expect(adapter.calls).toHaveLength(2);
  });

  test("multi-round streaming completes successfully", async () => {
    const round1Events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "tool",
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

    const round2Events: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      { type: StreamEventType.TEXT_START },
      { type: StreamEventType.TEXT_DELTA, delta: "Done" },
      { type: StreamEventType.TEXT_END },
      {
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      },
    ];

    const adapter = new StubAdapter("stub", [
      { events: round1Events },
      { events: round2Events },
    ]);
    const client = makeClient(adapter);

    const result = stream({
      model: "test-model",
      prompt: "use tool",
      tools: [
        {
          name: "tool",
          description: "A tool",
          parameters: { type: "object" },
          execute: async () => "ok",
        },
      ],
      maxToolRounds: 2,
      client,
    });

    const collected: StreamEvent[] = [];
    for await (const event of result) {
      collected.push(event);
    }

    // Should have events from both rounds
    expect(adapter.calls).toHaveLength(2);
    const streamStarts = collected.filter((e) => e.type === StreamEventType.STREAM_START);
    expect(streamStarts).toHaveLength(2);

    const response = await result.response();
    expect(response.finishReason.reason).toBe("stop");
  });

  test("streaming with tool returning structured data", async () => {
    const toolCallEvents: StreamEvent[] = [
      { type: StreamEventType.STREAM_START, model: "test-model" },
      {
        type: StreamEventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolName: "data_tool",
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

    const finalEvents = makeStreamEvents("Got data");

    const adapter = new StubAdapter("stub", [
      { events: toolCallEvents },
      { events: finalEvents },
    ]);
    const client = makeClient(adapter);

    let receivedData: unknown;
    const result = stream({
      model: "test-model",
      prompt: "get data",
      tools: [
        {
          name: "data_tool",
          description: "Returns object",
          parameters: { type: "object" },
          execute: async () => {
            const data = { items: ["a", "b"], count: 2 };
            receivedData = data;
            return data;
          },
        },
      ],
      client,
    });

    for await (const _event of result) {
      // consume
    }

    expect(receivedData).toEqual({ items: ["a", "b"], count: 2 });
  });
});
