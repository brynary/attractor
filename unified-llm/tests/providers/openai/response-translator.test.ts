import { describe, test, expect } from "bun:test";
import { translateResponse } from "../../../src/providers/openai/response-translator.js";

describe("OpenAI Response Translator", () => {
  test("translates text response", () => {
    const body = {
      id: "resp_001",
      model: "gpt-4o",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Hello! How can I help?" },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    };

    const response = translateResponse(body);

    expect(response.id).toBe("resp_001");
    expect(response.model).toBe("gpt-4o");
    expect(response.provider).toBe("openai");
    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toEqual([
      { kind: "text", text: "Hello! How can I help?" },
    ]);
    expect(response.finishReason).toEqual({ reason: "stop", raw: "completed" });
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(20);
    expect(response.usage.totalTokens).toBe(30);
    expect(response.warnings).toEqual([]);
  });

  test("translates function call response", () => {
    const body = {
      id: "resp_002",
      model: "gpt-4o",
      status: "completed",
      output: [
        {
          type: "function_call",
          id: "call_abc",
          name: "get_weather",
          arguments: '{"city":"San Francisco"}',
        },
      ],
      usage: {
        input_tokens: 15,
        output_tokens: 25,
      },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      {
        kind: "tool_call",
        toolCall: {
          id: "call_abc",
          name: "get_weather",
          arguments: { city: "San Francisco" },
        },
      },
    ]);
    expect(response.finishReason).toEqual({
      reason: "tool_calls",
      raw: "completed",
    });
  });

  test("translates mixed output (text + function calls)", () => {
    const body = {
      id: "resp_003",
      model: "gpt-4o",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Let me check that for you." },
          ],
        },
        {
          type: "function_call",
          id: "call_xyz",
          name: "search",
          arguments: '{"query":"weather"}',
        },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 30,
      },
    };

    const response = translateResponse(body);

    expect(response.message.content).toHaveLength(2);
    expect(response.message.content[0]).toEqual({
      kind: "text",
      text: "Let me check that for you.",
    });
    expect(response.message.content[1]).toEqual({
      kind: "tool_call",
      toolCall: {
        id: "call_xyz",
        name: "search",
        arguments: { query: "weather" },
      },
    });
    expect(response.finishReason.reason).toBe("tool_calls");
  });

  test("maps incomplete status to length finish reason", () => {
    const body = {
      id: "resp_004",
      model: "gpt-4o",
      status: "incomplete",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Partial..." }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 100 },
    };

    const response = translateResponse(body);
    expect(response.finishReason).toEqual({
      reason: "length",
      raw: "incomplete",
    });
  });

  test("maps failed status to error finish reason", () => {
    const body = {
      id: "resp_005",
      model: "gpt-4o",
      status: "failed",
      output: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    };

    const response = translateResponse(body);
    expect(response.finishReason).toEqual({
      reason: "error",
      raw: "failed",
    });
  });

  test("translates usage with reasoning tokens and cache tokens", () => {
    const body = {
      id: "resp_006",
      model: "o3",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 50 },
        output_tokens_details: { reasoning_tokens: 80 },
      },
    };

    const response = translateResponse(body);

    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(200);
    expect(response.usage.totalTokens).toBe(300);
    expect(response.usage.reasoningTokens).toBe(80);
    expect(response.usage.cacheReadTokens).toBe(50);
  });

  test("includes rateLimit when provided", () => {
    const body = {
      id: "resp_007",
      model: "gpt-4o",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "OK" }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 5 },
    };

    const rateLimit = {
      requestsRemaining: 99,
      requestsLimit: 100,
    };

    const response = translateResponse(body, rateLimit);
    expect(response.rateLimit).toEqual(rateLimit);
  });

  test("handles missing usage gracefully", () => {
    const body = {
      id: "resp_008",
      model: "gpt-4o",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi" }],
        },
      ],
    };

    const response = translateResponse(body);
    expect(response.usage.inputTokens).toBe(0);
    expect(response.usage.outputTokens).toBe(0);
    expect(response.usage.totalTokens).toBe(0);
  });
});
