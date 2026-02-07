import { describe, test, expect } from "bun:test";
import { translateStream } from "../../../src/providers/openai/stream-translator.js";
import type { SSEEvent } from "../../../src/utils/sse.js";
import { StreamEventType } from "../../../src/types/stream-event.js";
import type { StreamEvent } from "../../../src/types/stream-event.js";

async function* makeSSEStream(
  events: SSEEvent[],
): AsyncGenerator<SSEEvent> {
  for (const event of events) {
    yield event;
  }
}

async function collectEvents(
  gen: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("OpenAI Stream Translator", () => {
  test("translates text streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ id: "resp_001", model: "gpt-4o" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "Hello" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: " world" }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({ item: { type: "output_text" } }),
      },
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            status: "completed",
            output: [],
            usage: { input_tokens: 5, output_tokens: 10 },
          },
        }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    expect(events[0]?.type).toBe(StreamEventType.STREAM_START);
    expect(events[1]?.type).toBe(StreamEventType.TEXT_START);
    expect(events[2]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: "Hello",
    });
    expect(events[3]).toEqual({
      type: StreamEventType.TEXT_DELTA,
      text: " world",
    });
    expect(events[4]?.type).toBe(StreamEventType.TEXT_END);
    expect(events[5]?.type).toBe(StreamEventType.FINISH);
  });

  test("emits TEXT_START on first text delta only", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "A" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "B" }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    const textStarts = events.filter(
      (e) => e.type === StreamEventType.TEXT_START,
    );
    expect(textStarts).toHaveLength(1);
    expect(events[0]?.type).toBe(StreamEventType.TEXT_START);
    expect(events[1]).toEqual({ type: StreamEventType.TEXT_DELTA, text: "A" });
    expect(events[2]).toEqual({ type: StreamEventType.TEXT_DELTA, text: "B" });
  });

  test("translates function call streaming events", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.output_item.added",
        data: JSON.stringify({
          item: { type: "function_call", id: "call_123", name: "get_weather" },
        }),
      },
      {
        event: "response.function_call_arguments.delta",
        data: JSON.stringify({ item_id: "call_123", delta: '{"city":' }),
      },
      {
        event: "response.function_call_arguments.delta",
        data: JSON.stringify({ item_id: "call_123", delta: '"SF"}' }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({
          item: { type: "function_call", id: "call_123" },
        }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    expect(events[0]).toEqual({
      type: StreamEventType.TOOL_CALL_START,
      toolCallId: "call_123",
      toolName: "get_weather",
    });
    expect(events[1]).toEqual({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "call_123",
      argumentsDelta: '{"city":',
    });
    expect(events[2]).toEqual({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "call_123",
      argumentsDelta: '"SF"}',
    });
    expect(events[3]).toEqual({
      type: StreamEventType.TOOL_CALL_END,
      toolCallId: "call_123",
    });
  });

  test("complete stream lifecycle", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ id: "resp_full", model: "gpt-4o" }),
      },
      {
        event: "response.output_text.delta",
        data: JSON.stringify({ delta: "Let me check." }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({ item: { type: "output_text" } }),
      },
      {
        event: "response.output_item.added",
        data: JSON.stringify({
          item: { type: "function_call", id: "call_1", name: "search" },
        }),
      },
      {
        event: "response.function_call_arguments.delta",
        data: JSON.stringify({ item_id: "call_1", delta: '{"q":"test"}' }),
      },
      {
        event: "response.output_item.done",
        data: JSON.stringify({
          item: { type: "function_call", id: "call_1" },
        }),
      },
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            status: "completed",
            output: [{ type: "function_call" }],
            usage: {
              input_tokens: 20,
              output_tokens: 40,
              output_tokens_details: { reasoning_tokens: 10 },
            },
          },
        }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      StreamEventType.STREAM_START,
      StreamEventType.TEXT_START,
      StreamEventType.TEXT_DELTA,
      StreamEventType.TEXT_END,
      StreamEventType.TOOL_CALL_START,
      StreamEventType.TOOL_CALL_DELTA,
      StreamEventType.TOOL_CALL_END,
      StreamEventType.FINISH,
    ]);

    const finishEvent = events[events.length - 1];
    if (finishEvent?.type === StreamEventType.FINISH) {
      expect(finishEvent.finishReason).toBe("tool_calls");
      expect(finishEvent.usage?.inputTokens).toBe(20);
      expect(finishEvent.usage?.outputTokens).toBe(40);
      expect(finishEvent.usage?.totalTokens).toBe(60);
      expect(finishEvent.usage?.reasoningTokens).toBe(10);
    }
  });

  test("finish event with completed status and no tool calls maps to stop", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.completed",
        data: JSON.stringify({
          response: {
            status: "completed",
            output: [{ type: "message" }],
            usage: { input_tokens: 5, output_tokens: 5 },
          },
        }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    const finish = events[0];
    if (finish?.type === StreamEventType.FINISH) {
      expect(finish.finishReason).toBe("stop");
    }
  });

  test("handles stream_start model extraction", async () => {
    const sseEvents: SSEEvent[] = [
      {
        event: "response.created",
        data: JSON.stringify({ model: "gpt-4o-2024-11-20" }),
      },
    ];

    const events = await collectEvents(
      translateStream(makeSSEStream(sseEvents)),
    );

    const start = events[0];
    if (start?.type === StreamEventType.STREAM_START) {
      expect(start.model).toBe("gpt-4o-2024-11-20");
    }
  });
});
