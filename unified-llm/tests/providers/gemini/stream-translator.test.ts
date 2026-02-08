import { describe, test, expect } from "bun:test";
import { translateStream } from "../../../src/providers/gemini/stream-translator.js";
import { StreamEventType } from "../../../src/types/stream-event.js";
import type { SSEEvent } from "../../../src/utils/sse.js";

function makeSSE(data: Record<string, unknown>): SSEEvent {
  return { event: "message", data: JSON.stringify(data) };
}

async function collectEvents(events: SSEEvent[]) {
  async function* generate(): AsyncGenerator<SSEEvent> {
    for (const e of events) {
      yield e;
    }
  }

  const result = [];
  for await (const event of translateStream(generate())) {
    result.push(event);
  }
  return result;
}

describe("Gemini stream translator", () => {
  test("translates text streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "Hello" }], role: "model" },
          },
        ],
        modelVersion: "gemini-3-pro-preview",
      }),
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: " world" }], role: "model" },
          },
        ],
      }),
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "!" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
        },
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
    expect(events[1]?.type).toBe(StreamEventType.TEXT_START);
    expect(events[2]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "Hello",
    });
    expect(events[3]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: " world",
    });
    expect(events[4]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "!",
    });
    expect(events[5]?.type).toBe(StreamEventType.TEXT_END);

    const finish = events[6];
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toEqual({ reason: "stop", raw: "STOP" });
      expect(finish.usage?.inputTokens).toBe(10);
      expect(finish.usage?.outputTokens).toBe(5);
      expect(finish.usage?.totalTokens).toBe(15);
    }
  });

  test("translates tool call streaming (complete calls)", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "get_weather",
                    args: { city: "NYC" },
                  },
                },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 20 },
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);

    const toolStart = events[1];
    expect(toolStart?.type).toBe(StreamEventType.TOOL_CALL_START);
    if (toolStart?.type === StreamEventType.TOOL_CALL_START) {
      expect(toolStart.toolName).toBe("get_weather");
      expect(toolStart.toolCallId).toMatch(/^call_/);
    }

    const toolDelta = events[2];
    expect(toolDelta?.type).toBe(StreamEventType.TOOL_CALL_DELTA);
    if (toolDelta?.type === StreamEventType.TOOL_CALL_DELTA) {
      expect(toolDelta.argumentsDelta).toBe('{"city":"NYC"}');
    }

    const toolEnd = events[3];
    expect(toolEnd?.type).toBe(StreamEventType.TOOL_CALL_END);

    const finish = events[4];
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toEqual({ reason: "tool_calls", raw: "STOP" });
    }
  });

  test("text-only STOP produces stop finish reason", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "Hello" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);
    const finish = events.at(-1);

    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toEqual({ reason: "stop", raw: "STOP" });
    }
  });

  test("emits FINISH with usage data", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "OK" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 100,
          cachedContentTokenCount: 30,
        },
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);
    const finish = events.at(-1);

    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.usage?.inputTokens).toBe(50);
      expect(finish.usage?.outputTokens).toBe(2);
      expect(finish.usage?.totalTokens).toBe(52);
      expect(finish.usage?.reasoningTokens).toBe(100);
      expect(finish.usage?.cacheReadTokens).toBe(30);
      expect(finish.usage?.cacheWriteTokens).toBeUndefined();
    }
  });

  test("accumulates usage from final chunk", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "First" }], role: "model" },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
        modelVersion: "gemini-3-pro-preview",
      }),
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: " Last" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    ];

    const events = await collectEvents(sseEvents);
    const finish = events.at(-1);

    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.usage?.outputTokens).toBe(5);
    }
  });

  test("skips unparseable data", async () => {
    const sseEvents: SSEEvent[] = [
      { event: "message", data: "not valid json" },
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "OK" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
  });

  test("emits PROVIDER_EVENT for non-message SSE events", async () => {
    const sseEvents: SSEEvent[] = [
      { event: "custom_event", data: "some payload" },
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "OK" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events[0]?.type).toBe(StreamEventType.PROVIDER_EVENT);
    if (events[0]?.type === StreamEventType.PROVIDER_EVENT) {
      expect(events[0].eventType).toBe("custom_event");
      expect(events[0].raw).toBe("some payload");
    }
  });

  test("includes raw usage data in FINISH event", async () => {
    const usageMetadata = {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
    };
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "Hello" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata,
        modelVersion: "gemini-3-pro-preview",
      }),
    ];

    const events = await collectEvents(sseEvents);
    const finish = events.at(-1);

    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.usage?.raw).toEqual(usageMetadata);
    }
  });

  test("translates thinking blocks in stream", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        candidates: [
          {
            content: {
              parts: [{ thought: true, text: "Let me think..." }],
              role: "model",
            },
          },
        ],
        modelVersion: "gemini-3-pro-preview",
      }),
      makeSSE({
        candidates: [
          {
            content: { parts: [{ text: "Answer" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
    expect(events[1]?.type).toBe(StreamEventType.REASONING_START);
    expect(events[2]).toEqual({
      type: StreamEventType.REASONING_DELTA,
      reasoningDelta: "Let me think...",
    });
    expect(events[3]?.type).toBe(StreamEventType.REASONING_END);
    expect(events[4]?.type).toBe(StreamEventType.TEXT_START);
    expect(events[5]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      delta: "Answer",
    });
    expect(events[6]?.type).toBe(StreamEventType.TEXT_END);
    expect(events[7]?.type).toBe(StreamEventType.FINISH);
  });
});
