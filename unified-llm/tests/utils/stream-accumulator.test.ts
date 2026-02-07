import { describe, test, expect } from "bun:test";
import { StreamAccumulator } from "../../src/utils/stream-accumulator.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import { Role } from "../../src/types/role.js";

describe("StreamAccumulator", () => {
  test("accumulates text events into a response", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, text: "Hello " });
    acc.process({ type: StreamEventType.TEXT_DELTA, text: "world" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({
      type: StreamEventType.FINISH,
      finishReason: "stop",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });

    const response = acc.response();
    expect(response.model).toBe("test-model");
    expect(response.message.role).toBe(Role.ASSISTANT);
    expect(response.message.content).toHaveLength(1);
    expect(response.message.content[0]).toEqual({
      kind: "text",
      text: "Hello world",
    });
    expect(response.finishReason.reason).toBe("stop");
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
  });

  test("accumulates tool call events", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({
      type: StreamEventType.TOOL_CALL_START,
      toolCallId: "tc-1",
      toolName: "search",
    });
    acc.process({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "tc-1",
      argumentsDelta: '{"q":',
    });
    acc.process({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "tc-1",
      argumentsDelta: '"test"}',
    });
    acc.process({ type: StreamEventType.TOOL_CALL_END, toolCallId: "tc-1" });
    acc.process({
      type: StreamEventType.FINISH,
      finishReason: "tool_calls",
    });

    const response = acc.response();
    expect(response.message.content).toHaveLength(1);
    const part = response.message.content[0];
    expect(part?.kind).toBe("tool_call");
    if (part?.kind === "tool_call") {
      expect(part.toolCall.id).toBe("tc-1");
      expect(part.toolCall.name).toBe("search");
      expect(part.toolCall.arguments).toEqual({ q: "test" });
    }
  });

  test("accumulates reasoning events", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.REASONING_START });
    acc.process({
      type: StreamEventType.REASONING_DELTA,
      text: "Let me think...",
    });
    acc.process({
      type: StreamEventType.REASONING_END,
      signature: "sig-123",
    });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, text: "Answer" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({ type: StreamEventType.FINISH, finishReason: "stop" });

    const response = acc.response();
    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]).toEqual({
      kind: "thinking",
      thinking: {
        text: "Let me think...",
        signature: "sig-123",
        redacted: false,
      },
    });
    expect(response.message.content[1]).toEqual({
      kind: "text",
      text: "Answer",
    });
  });

  test("handles mixed text and tool calls", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, text: "I will search" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({
      type: StreamEventType.TOOL_CALL_START,
      toolCallId: "tc-1",
      toolName: "search",
    });
    acc.process({
      type: StreamEventType.TOOL_CALL_DELTA,
      toolCallId: "tc-1",
      argumentsDelta: "{}",
    });
    acc.process({ type: StreamEventType.TOOL_CALL_END, toolCallId: "tc-1" });
    acc.process({
      type: StreamEventType.FINISH,
      finishReason: "tool_calls",
    });

    const response = acc.response();
    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]?.kind).toBe("text");
    expect(response.message.content[1]?.kind).toBe("tool_call");
  });
});
