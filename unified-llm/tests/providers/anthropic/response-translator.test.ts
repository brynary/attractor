import { describe, test, expect } from "bun:test";
import { translateResponse } from "../../../src/providers/anthropic/response-translator.js";
import { Role } from "../../../src/types/role.js";

describe("Anthropic response translator", () => {
  test("translates text response", () => {
    const body = {
      id: "msg_123",
      model: "claude-opus-4-6",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    const response = translateResponse(body);

    expect(response.id).toBe("msg_123");
    expect(response.model).toBe("claude-opus-4-6");
    expect(response.provider).toBe("anthropic");
    expect(response.message.role).toBe(Role.ASSISTANT);
    expect(response.message.content).toEqual([
      { kind: "text", text: "Hello!" },
    ]);
    expect(response.finishReason).toEqual({ reason: "stop", raw: "end_turn" });
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.warnings).toEqual([]);
  });

  test("translates tool use response", () => {
    const body = {
      id: "msg_456",
      model: "claude-opus-4-6",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "I'll check the weather." },
        {
          type: "tool_use",
          id: "tc1",
          name: "get_weather",
          input: { city: "NYC" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 15 },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      { kind: "text", text: "I'll check the weather." },
      {
        kind: "tool_call",
        toolCall: {
          id: "tc1",
          name: "get_weather",
          arguments: { city: "NYC" },
        },
      },
    ]);
    expect(response.finishReason).toEqual({
      reason: "tool_calls",
      raw: "tool_use",
    });
  });

  test("translates thinking blocks", () => {
    const body = {
      id: "msg_789",
      model: "claude-opus-4-6",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Let me analyze this...",
          signature: "sig_abc",
        },
        { type: "text", text: "The answer is 42." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 30, output_tokens: 25 },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      {
        kind: "thinking",
        thinking: {
          text: "Let me analyze this...",
          signature: "sig_abc",
          redacted: false,
        },
      },
      { kind: "text", text: "The answer is 42." },
    ]);
  });

  test("translates redacted thinking blocks", () => {
    const body = {
      id: "msg_red",
      model: "claude-opus-4-6",
      type: "message",
      role: "assistant",
      content: [
        { type: "redacted_thinking", data: "encrypted-data" },
        { type: "text", text: "Here's my answer." },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 10 },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      {
        kind: "redacted_thinking",
        thinking: { text: "encrypted-data", redacted: true },
      },
      { kind: "text", text: "Here's my answer." },
    ]);
  });

  test("maps end_turn to stop", () => {
    const body = {
      id: "msg_1",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("stop");
  });

  test("maps stop_sequence to stop", () => {
    const body = {
      id: "msg_2",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Done" }],
      stop_reason: "stop_sequence",
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("stop");
  });

  test("maps max_tokens to length", () => {
    const body = {
      id: "msg_3",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Truncated" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 1, output_tokens: 100 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("length");
  });

  test("maps tool_use to tool_calls", () => {
    const body = {
      id: "msg_4",
      model: "claude-opus-4-6",
      content: [{ type: "tool_use", id: "tc1", name: "test", input: {} }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("tool_calls");
  });

  test("maps unknown stop reason to other", () => {
    const body = {
      id: "msg_5",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "?" }],
      stop_reason: "unknown_reason",
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    expect(translateResponse(body).finishReason.reason).toBe("other");
  });

  test("maps usage with cache tokens", () => {
    const body = {
      id: "msg_cache",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Cached" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    };

    const response = translateResponse(body);

    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
    expect(response.usage.totalTokens).toBe(150);
    expect(response.usage.cacheReadTokens).toBe(80);
    expect(response.usage.cacheWriteTokens).toBe(20);
  });

  test("passes rateLimit info through", () => {
    const body = {
      id: "msg_rl",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };

    const rateLimit = {
      requestsRemaining: 100,
      tokensRemaining: 50000,
    };

    const response = translateResponse(body, rateLimit);

    expect(response.rateLimit).toEqual(rateLimit);
  });
});
