import { describe, test, expect } from "bun:test";
import { translateResponse } from "../../../src/providers/openai-compatible/response-translator.js";

describe("OpenAI-Compatible Response Translator", () => {
  test("translates text response", () => {
    const body = {
      id: "chatcmpl-001",
      model: "llama-3-70b",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello! How can I help?",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    const response = translateResponse(body);

    expect(response.id).toBe("chatcmpl-001");
    expect(response.model).toBe("llama-3-70b");
    expect(response.provider).toBe("openai-compatible");
    expect(response.message.role).toBe("assistant");
    expect(response.message.content).toEqual([
      { kind: "text", text: "Hello! How can I help?" },
    ]);
    expect(response.finishReason).toEqual({ reason: "stop", raw: "stop" });
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(20);
    expect(response.usage.totalTokens).toBe(30);
    expect(response.warnings).toEqual([]);
  });

  test("translates tool call response", () => {
    const body = {
      id: "chatcmpl-002",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"city":"San Francisco"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
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
          rawArguments: '{"city":"San Francisco"}',
        },
      },
    ]);
    expect(response.finishReason).toEqual({
      reason: "tool_calls",
      raw: "tool_calls",
    });
  });

  test("translates mixed response (text + tool calls)", () => {
    const body = {
      id: "chatcmpl-003",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Let me check that for you.",
            tool_calls: [
              {
                id: "call_xyz",
                type: "function",
                function: {
                  name: "search",
                  arguments: '{"query":"weather"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 30,
        total_tokens: 42,
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
        rawArguments: '{"query":"weather"}',
      },
    });
    expect(response.finishReason.reason).toBe("tool_calls");
  });

  test("falls back to empty object when arguments JSON is invalid", () => {
    const body = {
      id: "chatcmpl-bad",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: {
                  name: "broken",
                  arguments: "not valid json{",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };

    const response = translateResponse(body);

    expect(response.message.content).toEqual([
      {
        kind: "tool_call",
        toolCall: {
          id: "call_bad",
          name: "broken",
          arguments: {},
          rawArguments: "not valid json{",
        },
      },
    ]);
  });

  test("maps length finish reason", () => {
    const body = {
      id: "chatcmpl-004",
      model: "llama-3-70b",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Partial...",
          },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 100, total_tokens: 105 },
    };

    const response = translateResponse(body);
    expect(response.finishReason).toEqual({
      reason: "length",
      raw: "length",
    });
  });

  test("maps content_filter finish reason", () => {
    const body = {
      id: "chatcmpl-005",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "content_filter",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    };

    const response = translateResponse(body);
    expect(response.finishReason).toEqual({
      reason: "content_filter",
      raw: "content_filter",
    });
  });

  test("translates usage with reasoning and cache tokens (when provided)", () => {
    // Note: Most OpenAI-compatible services (vLLM, Ollama, Together AI, Groq) do NOT
    // provide reasoning_tokens or cached_tokens as these are Responses API features.
    // This test verifies that IF a service provides these fields, they are extracted.
    // In practice, these fields will typically be undefined for third-party services.
    const body = {
      id: "chatcmpl-006",
      model: "o3",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Done." },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
        prompt_tokens_details: { cached_tokens: 50 },
        completion_tokens_details: { reasoning_tokens: 80 },
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
      id: "chatcmpl-007",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "OK" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
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
      id: "chatcmpl-008",
      model: "llama-3-70b",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi" },
          finish_reason: "stop",
        },
      ],
    };

    const response = translateResponse(body);
    expect(response.usage.inputTokens).toBe(0);
    expect(response.usage.outputTokens).toBe(0);
    expect(response.usage.totalTokens).toBe(0);
  });

  test("handles empty choices gracefully", () => {
    const body = {
      id: "chatcmpl-009",
      model: "llama-3-70b",
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    };

    const response = translateResponse(body);
    expect(response.message.content).toEqual([]);
    expect(response.finishReason).toEqual({ reason: "other", raw: "" });
  });
});
