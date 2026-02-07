import { describe, test, expect } from "bun:test";
import { stream } from "../../src/api/stream.js";
import { Client } from "../../src/client/client.js";
import { StubAdapter } from "../stubs/stub-adapter.js";
import type { StreamEvent } from "../../src/types/stream-event.js";
import { StreamEventType } from "../../src/types/stream-event.js";

function makeStreamEvents(text: string): StreamEvent[] {
  return [
    { type: StreamEventType.STREAM_START, model: "test-model" },
    { type: StreamEventType.TEXT_START },
    { type: StreamEventType.TEXT_DELTA, text },
    { type: StreamEventType.TEXT_END },
    {
      type: StreamEventType.FINISH,
      finishReason: "stop",
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
    for await (const text of result.textStream()) {
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
      { type: StreamEventType.TEXT_DELTA, text: "Hello " },
      { type: StreamEventType.TEXT_DELTA, text: "world" },
      { type: StreamEventType.TEXT_END },
      {
        type: StreamEventType.FINISH,
        finishReason: "stop",
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
    for await (const text of result.textStream()) {
      texts.push(text);
    }

    expect(texts).toEqual(["Hello ", "world"]);
  });
});
