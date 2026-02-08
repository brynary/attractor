import { describe, test, expect } from "bun:test";
import { StreamAccumulator } from "../../src/utils/stream-accumulator.js";
import { StreamEventType } from "../../src/types/stream-event.js";
import { Role } from "../../src/types/role.js";

describe("StreamAccumulator", () => {
  test("accumulates text events into a response", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Hello " });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "world" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({
      type: StreamEventType.FINISH,
      finishReason: { reason: "stop" },
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

  test("handles interleaved text segments by textId", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.TEXT_START, textId: "a" });
    acc.process({ type: StreamEventType.TEXT_DELTA, textId: "a", delta: "Hello" });
    acc.process({ type: StreamEventType.TEXT_START, textId: "b" });
    acc.process({ type: StreamEventType.TEXT_DELTA, textId: "b", delta: " world" });
    acc.process({ type: StreamEventType.TEXT_DELTA, textId: "a", delta: "!" });
    acc.process({ type: StreamEventType.TEXT_END, textId: "a" });
    acc.process({ type: StreamEventType.TEXT_END, textId: "b" });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.message.content[0]).toEqual({
      kind: "text",
      text: "Hello! world",
    });
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
      finishReason: { reason: "tool_calls" },
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
      reasoningDelta: "Let me think...",
    });
    acc.process({
      type: StreamEventType.REASONING_END,
      signature: "sig-123",
    });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Answer" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

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

  test("handles interleaved reasoning segments by reasoningId", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.REASONING_START, reasoningId: "r1" });
    acc.process({
      type: StreamEventType.REASONING_DELTA,
      reasoningId: "r1",
      reasoningDelta: "Think ",
    });
    acc.process({ type: StreamEventType.REASONING_START, reasoningId: "r2" });
    acc.process({
      type: StreamEventType.REASONING_DELTA,
      reasoningId: "r2",
      reasoningDelta: "deep",
    });
    acc.process({
      type: StreamEventType.REASONING_DELTA,
      reasoningId: "r1",
      reasoningDelta: "more",
    });
    acc.process({
      type: StreamEventType.REASONING_END,
      reasoningId: "r1",
      signature: "sig-r1",
    });
    acc.process({ type: StreamEventType.REASONING_END, reasoningId: "r2" });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]).toEqual({
      kind: "thinking",
      thinking: {
        text: "Think more",
        signature: "sig-r1",
        redacted: false,
      },
    });
    expect(response.message.content[1]).toEqual({
      kind: "thinking",
      thinking: {
        text: "deep",
        signature: undefined,
        redacted: false,
      },
    });
  });

  test("preserves redacted reasoning events", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.REASONING_START });
    acc.process({
      type: StreamEventType.REASONING_DELTA,
      reasoningDelta: "opaque-redacted-data",
      redacted: true,
    });
    acc.process({ type: StreamEventType.REASONING_END });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.message.content).toHaveLength(1);
    expect(response.message.content[0]).toEqual({
      kind: "redacted_thinking",
      thinking: {
        text: "opaque-redacted-data",
        redacted: true,
      },
    });
  });

  test("handles mixed text and tool calls", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "I will search" });
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
      finishReason: { reason: "tool_calls" },
    });

    const response = acc.response();
    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]?.kind).toBe("text");
    expect(response.message.content[1]?.kind).toBe("tool_call");
  });

  test("response has empty warnings by default", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.warnings).toEqual([]);
  });

  test("includes warnings from STREAM_START events", () => {
    const acc = new StreamAccumulator();
    acc.process({
      type: StreamEventType.STREAM_START,
      model: "test-model",
      warnings: [{ message: "Dropped unsupported content", code: "unsupported_part" }],
    });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.warnings).toEqual([
      { message: "Dropped unsupported content", code: "unsupported_part" },
    ]);
  });

  test("addWarning accumulates warnings into response", () => {
    const acc = new StreamAccumulator();
    acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
    acc.addWarning({ message: "Deprecated model", code: "DEPRECATED" });
    acc.addWarning({ message: "Slow response" });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.warnings).toHaveLength(2);
    expect(response.warnings[0]).toEqual({ message: "Deprecated model", code: "DEPRECATED" });
    expect(response.warnings[1]).toEqual({ message: "Slow response" });
  });

  test("captures id and provider", () => {
    const acc = new StreamAccumulator("anthropic");
    acc.process({ type: StreamEventType.STREAM_START, id: "msg_123", model: "claude-opus-4-6" });
    acc.process({ type: StreamEventType.TEXT_START });
    acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Hi" });
    acc.process({ type: StreamEventType.TEXT_END });
    acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

    const response = acc.response();
    expect(response.id).toBe("msg_123");
    expect(response.provider).toBe("anthropic");
  });

  describe("multi-step tracking", () => {
    test("tracks single step", () => {
      const acc = new StreamAccumulator("openai");
      acc.process({ type: StreamEventType.STREAM_START, model: "gpt-5.2", id: "resp_1" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Step 1" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      acc.finalizeStep();

      const steps = acc.getSteps();
      expect(steps).toHaveLength(1);
      expect(steps[0]?.text).toBe("Step 1");
      expect(steps[0]?.finishReason.reason).toBe("stop");
      expect(steps[0]?.usage.inputTokens).toBe(10);
      expect(steps[0]?.toolCalls).toEqual([]);
      expect(steps[0]?.warnings).toEqual([]);
    });

    test("tracks multiple steps", () => {
      const acc = new StreamAccumulator("anthropic");

      acc.process({ type: StreamEventType.STREAM_START, model: "claude-opus-4-6" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "First" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({
        type: StreamEventType.FINISH,
        finishReason: { reason: "tool_calls" },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      acc.finalizeStep();

      acc.beginStep();
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Second" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({
        type: StreamEventType.FINISH,
        finishReason: { reason: "stop" },
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
      });
      acc.finalizeStep();

      const steps = acc.getSteps();
      expect(steps).toHaveLength(2);
      expect(steps[0]?.text).toBe("First");
      expect(steps[0]?.finishReason.reason).toBe("tool_calls");
      expect(steps[1]?.text).toBe("Second");
      expect(steps[1]?.finishReason.reason).toBe("stop");
    });

    test("beginStep resets accumulator state", () => {
      const acc = new StreamAccumulator();
      acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "First" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.addWarning({ message: "Warning 1" });

      acc.beginStep();

      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Second" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

      const response = acc.response();
      expect(response.message.content).toHaveLength(1);
      expect(response.message.content[0]?.kind).toBe("text");
      if (response.message.content[0]?.kind === "text") {
        expect(response.message.content[0].text).toBe("Second");
      }
      expect(response.warnings).toEqual([]);
    });

    test("tracks tool calls in steps", () => {
      const acc = new StreamAccumulator();
      acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
      acc.process({ type: StreamEventType.TOOL_CALL_START, toolCallId: "tc-1", toolName: "search" });
      acc.process({ type: StreamEventType.TOOL_CALL_DELTA, toolCallId: "tc-1", argumentsDelta: '{"q":"test"}' });
      acc.process({ type: StreamEventType.TOOL_CALL_END, toolCallId: "tc-1" });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "tool_calls" } });

      acc.finalizeStep();

      const steps = acc.getSteps();
      expect(steps).toHaveLength(1);
      expect(steps[0]?.toolCalls).toHaveLength(1);
      expect(steps[0]?.toolCalls[0]?.name).toBe("search");
      expect(steps[0]?.toolCalls[0]?.arguments).toEqual({ q: "test" });
    });

    test("tracks reasoning in steps", () => {
      const acc = new StreamAccumulator();
      acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
      acc.process({ type: StreamEventType.REASONING_START });
      acc.process({ type: StreamEventType.REASONING_DELTA, reasoningDelta: "Thinking..." });
      acc.process({ type: StreamEventType.REASONING_END, signature: "sig-1" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Answer" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

      acc.finalizeStep();

      const steps = acc.getSteps();
      expect(steps).toHaveLength(1);
      expect(steps[0]?.reasoning).toBe("Thinking...");
      expect(steps[0]?.text).toBe("Answer");
    });

    test("getStepCount returns correct count", () => {
      const acc = new StreamAccumulator();
      expect(acc.getStepCount()).toBe(0);

      acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Step 1" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });
      acc.finalizeStep();

      expect(acc.getStepCount()).toBe(1);

      acc.beginStep();
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Step 2" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });
      acc.finalizeStep();

      expect(acc.getStepCount()).toBe(2);
    });

    test("maintains backward compatibility without step methods", () => {
      const acc = new StreamAccumulator();
      acc.process({ type: StreamEventType.STREAM_START, model: "test-model" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Single response" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });

      const response = acc.response();
      expect(response.message.content).toHaveLength(1);
      if (response.message.content[0]?.kind === "text") {
        expect(response.message.content[0].text).toBe("Single response");
      }

      const steps = acc.getSteps();
      expect(steps).toHaveLength(0);
    });

    test("each step has its own response object", () => {
      const acc = new StreamAccumulator("openai");
      acc.process({ type: StreamEventType.STREAM_START, model: "gpt-5.2", id: "resp_1" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Step 1" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "tool_calls" } });
      acc.finalizeStep();

      acc.beginStep();
      acc.process({ type: StreamEventType.STREAM_START, model: "gpt-5.2", id: "resp_2" });
      acc.process({ type: StreamEventType.TEXT_START });
      acc.process({ type: StreamEventType.TEXT_DELTA, delta: "Step 2" });
      acc.process({ type: StreamEventType.TEXT_END });
      acc.process({ type: StreamEventType.FINISH, finishReason: { reason: "stop" } });
      acc.finalizeStep();

      const steps = acc.getSteps();
      expect(steps[0]?.response.id).toBe("resp_1");
      expect(steps[0]?.response.model).toBe("gpt-5.2");
      expect(steps[1]?.response.id).toBe("resp_2");
      expect(steps[1]?.response.model).toBe("gpt-5.2");
    });
  });
});
