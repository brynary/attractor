import { describe, test, expect } from "bun:test";
import { translateStream } from "../../../src/providers/anthropic/stream-translator.js";
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

describe("Anthropic stream translator", () => {
  test("translates text streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        type: "message_start",
        message: { model: "claude-opus-4-6", usage: { input_tokens: 10 } },
      }),
      makeSSE({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      }),
      makeSSE({ type: "content_block_stop", index: 0 }),
      makeSSE({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 5 },
      }),
      makeSSE({ type: "message_stop" }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events.at(0)?.type).toBe(StreamEventType.STREAM_START);
    expect(events.at(1)?.type).toBe(StreamEventType.TEXT_START);
    expect(events.at(2)).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: "Hello",
    });
    expect(events.at(3)).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: " world",
    });
    expect(events.at(4)?.type).toBe(StreamEventType.TEXT_END);

    const finish = events.at(5);
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toBe("stop");
      expect(finish.usage?.inputTokens).toBe(10);
      expect(finish.usage?.outputTokens).toBe(5);
      expect(finish.usage?.totalTokens).toBe(15);
    }
  });

  test("translates tool call streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        type: "message_start",
        message: { model: "claude-opus-4-6", usage: { input_tokens: 5 } },
      }),
      makeSSE({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tc1",
          name: "get_weather",
        },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city"' },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: ': "NYC"}' },
      }),
      makeSSE({ type: "content_block_stop", index: 0 }),
      makeSSE({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 20 },
      }),
      makeSSE({ type: "message_stop" }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events.at(0)?.type).toBe(StreamEventType.STREAM_START);
    expect(events.at(1)).toEqual({
      type: StreamEventType.TOOL_CALL_START,
      toolCallId: "tc1",
      toolName: "get_weather",
    });
    expect(events.at(2)).toEqual({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "tc1",
      argumentsDelta: '{"city"',
    });
    expect(events.at(3)).toEqual({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "tc1",
      argumentsDelta: ': "NYC"}',
    });
    expect(events.at(4)).toEqual({
      type: StreamEventType.TOOL_CALL_END,
      toolCallId: "tc1",
    });

    const finish = events.at(5);
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toBe("tool_calls");
    }
  });

  test("translates thinking streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        type: "message_start",
        message: { model: "claude-opus-4-6", usage: { input_tokens: 15 } },
      }),
      makeSSE({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking" },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      }),
      makeSSE({ type: "content_block_stop", index: 0 }),
      makeSSE({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Answer" },
      }),
      makeSSE({ type: "content_block_stop", index: 1 }),
      makeSSE({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 30 },
      }),
      makeSSE({ type: "message_stop" }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events.at(0)?.type).toBe(StreamEventType.STREAM_START);
    expect(events.at(1)?.type).toBe(StreamEventType.REASONING_START);
    expect(events.at(2)).toEqual({
      type: StreamEventType.REASONING_DELTA,
      text: "Let me think...",
    });
    expect(events.at(3)?.type).toBe(StreamEventType.REASONING_END);
    expect(events.at(4)?.type).toBe(StreamEventType.TEXT_START);
    expect(events.at(5)).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: "Answer",
    });
    expect(events.at(6)?.type).toBe(StreamEventType.TEXT_END);
    expect(events.at(7)?.type).toBe(StreamEventType.FINISH);
  });

  test("complete stream lifecycle with cache tokens", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        type: "message_start",
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 50,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      makeSSE({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      makeSSE({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "OK" },
      }),
      makeSSE({ type: "content_block_stop", index: 0 }),
      makeSSE({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 2 },
      }),
      makeSSE({ type: "message_stop" }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events.at(0)?.type).toBe(StreamEventType.STREAM_START);

    const finish = events.at(-1);
    expect(finish?.type).toBe(StreamEventType.FINISH);
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toBe("stop");
      expect(finish.usage?.inputTokens).toBe(50);
      expect(finish.usage?.outputTokens).toBe(2);
      expect(finish.usage?.totalTokens).toBe(52);
      expect(finish.usage?.cacheReadTokens).toBe(30);
      expect(finish.usage?.cacheWriteTokens).toBe(10);
    }
  });

  test("handles error events", async () => {
    const sseEvents: SSEEvent[] = [
      makeSSE({
        type: "message_start",
        message: { model: "claude-opus-4-6", usage: { input_tokens: 1 } },
      }),
      makeSSE({
        type: "error",
        error: { type: "overloaded_error", message: "Server overloaded" },
      }),
    ];

    const events = await collectEvents(sseEvents);

    const errorEvent = events.at(1);
    expect(errorEvent?.type).toBe(StreamEventType.ERROR);
    if (errorEvent?.type === StreamEventType.ERROR) {
      expect(errorEvent.error.message).toBe("Server overloaded");
    }
  });

  test("skips unparseable data", async () => {
    const sseEvents: SSEEvent[] = [
      { event: "message", data: "not valid json" },
      makeSSE({
        type: "message_start",
        message: { model: "claude-opus-4-6", usage: { input_tokens: 1 } },
      }),
    ];

    const events = await collectEvents(sseEvents);

    expect(events).toHaveLength(1);
    expect(events.at(0)?.type).toBe(StreamEventType.STREAM_START);
  });
});
